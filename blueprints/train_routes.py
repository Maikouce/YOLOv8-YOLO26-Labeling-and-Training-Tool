import os
import sys
import subprocess
import threading
import uuid
import shutil
import re
import time
import queue
import signal
from flask import Blueprint, render_template, request, jsonify, Response, send_from_directory, current_app, abort
from flask_login import login_required, current_user
from utils.dataset_helper import prepare_dataset_for_training
from models import TaskPermission

train_bp = Blueprint('train', __name__)

# ============ 全局状态管理 ============
training_streams = {}  # 存储日志流数据 (stream_id -> list[str])
task_queue = queue.Queue()
is_training_active = False

# 进程管理
running_processes = {}  # stream_id -> subprocess.Popen
# 记录每个 Task 对应的 active stream_id，用于刷新页面后重连
# 格式: { "owner/task_name": "stream_id" }
active_tasks_map = {}

cancelled_tasks = set()
process_lock = threading.Lock()


# ============ 辅助函数 ============

def check_perm(owner, task_name):
    if current_user.is_admin: return True
    if owner == current_user.username: return True
    perm = TaskPermission.query.filter_by(user_id=current_user.id, owner_name=owner, task_name=task_name).first()
    return True if perm else False


def find_latest_run_dir(runs_dir: str, base_name_prefix: str):
    if not os.path.isdir(runs_dir): return None
    candidates = []
    for d in os.listdir(runs_dir):
        if d.startswith(base_name_prefix):
            full = os.path.join(runs_dir, d)
            if os.path.isdir(full):
                try:
                    mtime = os.path.getmtime(full)
                except:
                    mtime = 0
                candidates.append((mtime, full))
    if not candidates: return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def kill_task(stream_id):
    """强制终止任务"""
    print(f"[手动停止] 收到终止请求: {stream_id}")
    cancelled_tasks.add(stream_id)

    with process_lock:
        if stream_id in running_processes:
            proc = running_processes[stream_id]
            try:
                print(f"🔪 正在终止进程 PID: {proc.pid}")
                # 发送 SIGTERM
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()  # 强杀
            except Exception as e:
                print(f"终止进程失败: {e}")
            finally:
                if stream_id in running_processes:
                    del running_processes[stream_id]


# ============ 核心：后台训练工作线程 ============
def training_worker():
    global is_training_active

    while True:
        task = task_queue.get()
        stream_id = task['stream_id']
        # 记录任务所有者，用于状态映射
        task_key = task.get('task_key')

        if stream_id in cancelled_tasks:
            if stream_id in training_streams:
                training_streams[stream_id].append("__ERROR__:任务在排队期间已被取消")
                training_streams[stream_id].append("__END_OF_STREAM__")

            # 清理映射
            if task_key and active_tasks_map.get(task_key) == stream_id:
                del active_tasks_map[task_key]

            task_queue.task_done()
            cancelled_tasks.discard(stream_id)
            continue

        is_training_active = True
        cmd = task['cmd']
        runs_dir = task['runs_dir']
        base_name = task['base_name']
        export_params = task['export_params']
        env = task['env']

        process = None

        try:
            if stream_id in training_streams:
                training_streams[stream_id].append(f"__STARTING__")
                training_streams[stream_id].append(f"🚀 任务开始执行 (后台运行中)...\n")

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding='utf-8',
                env=env,
                bufsize=1,
                universal_newlines=True
            )

            with process_lock:
                if stream_id in cancelled_tasks:
                    process.kill()
                    raise Exception("任务启动时被取消")
                running_processes[stream_id] = process

            ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

            # 实时读取日志
            with process.stdout:
                for line in iter(process.stdout.readline, ''):
                    if not line: break
                    clean_line = ansi_escape.sub('', line).rstrip()
                    # 限制内存：如果日志太长，切掉前面的（防止跑几天内存爆炸）
                    if stream_id in training_streams:
                        if len(training_streams[stream_id]) > 5000:
                            training_streams[stream_id] = training_streams[stream_id][-4000:]
                        training_streams[stream_id].append(clean_line)

            process.wait()

            if stream_id in cancelled_tasks:
                final_status = "__ERROR__:任务已被用户手动停止"
            elif process.returncode == 0:
                run_path = find_latest_run_dir(runs_dir, base_name)
                if run_path:
                    # --- 自动导出逻辑 (保持不变) ---
                    best_pt = os.path.join(run_path, 'weights', 'metal2.pt')  # 注意：你的代码里写死为metal2.pt，请确认是否正确，通常是best.pt
                    if not os.path.exists(best_pt):
                        best_pt = os.path.join(run_path, 'weights', 'best.pt')

                    if os.path.exists(best_pt):
                        try:
                            if stream_id in training_streams:
                                training_streams[stream_id].append(f"\n--- [自动导出] {export_params['format']} ---")

                            safe_best_pt = best_pt.replace('\\', '/')
                            export_script = f"""
from ultralytics import YOLO
import sys
if __name__ == '__main__':
    try:
        model = YOLO(r'{safe_best_pt}')
        res = model.export(format='{export_params["format"]}', opset={export_params["opset"]})
        print(f"Export Success: {{res}}")
    except Exception as e:
        print(f"Export Error: {{e}}")
        sys.exit(1)
"""
                            export_cmd = [sys.executable, '-u', '-c', export_script]
                            res = subprocess.run(export_cmd, capture_output=True, text=True, encoding='utf-8',
                                                 check=False, env=env)

                            if stream_id in training_streams:
                                training_streams[stream_id].append("\n" + res.stdout + "\n" + res.stderr)
                        except Exception as e:
                            if stream_id in training_streams:
                                training_streams[stream_id].append(f"\n--- 导出流程异常: {e} ---\n")

                    run_name = os.path.basename(run_path)
                    final_status = f"__SUCCESS__:{run_name}"
                else:
                    final_status = "__ERROR__:训练完成但未找到产物"
            else:
                final_status = f"__ERROR__:训练异常退出 (Code: {process.returncode})"

            if stream_id in training_streams:
                training_streams[stream_id].append(final_status)
                training_streams[stream_id].append("__END_OF_STREAM__")

        except Exception as e:
            if stream_id in training_streams:
                training_streams[stream_id].append(f"__ERROR__:执行错误: {str(e)}")
                training_streams[stream_id].append("__END_OF_STREAM__")

        finally:
            with process_lock:
                if stream_id in running_processes:
                    del running_processes[stream_id]

            # 任务结束后，清理映射关系
            if task_key and active_tasks_map.get(task_key) == stream_id:
                del active_tasks_map[task_key]

            cancelled_tasks.discard(stream_id)
            is_training_active = False
            task_queue.task_done()


# 启动线程
worker_thread = threading.Thread(target=training_worker, daemon=True)
worker_thread.start()


# ============ 路由定义 ============

@train_bp.route('/train/<owner>/<task_name>')
@login_required
def train_page(owner, task_name):
    if not check_perm(owner, task_name): abort(403)
    return render_template('train.html', owner=owner, task_name=task_name, user=current_user)


@train_bp.route('/api/get_models')
@login_required
def get_models():
    MODELS_FOLDER = current_app.config['MODELS_FOLDER']
    try:
        if not os.path.exists(MODELS_FOLDER): return jsonify([])
        return jsonify(sorted([f for f in os.listdir(MODELS_FOLDER) if f.endswith('.pt')]))
    except:
        return jsonify([])


# 【新增】检查当前是否有任务在运行
@train_bp.route('/api/check_status/<owner>/<task_name>')
@login_required
def check_status(owner, task_name):
    task_key = f"{owner}/{task_name}"
    # 检查是否有正在运行的 PID 或 队列中
    current_stream_id = active_tasks_map.get(task_key)

    if current_stream_id:
        # 确认一下是否真的还在内存里 (防止意外重启后 active_tasks_map 不准)
        if current_stream_id in training_streams:
            return jsonify({'status': 'running', 'stream_id': current_stream_id})

    return jsonify({'status': 'idle'})


# 【新增】手动停止训练接口
@train_bp.route('/api/stop_train/<stream_id>', methods=['POST'])
@login_required
def stop_train(stream_id):
    # 稍微做点权限校验，实际场景建议校验 stream_id 是否属于当前用户
    kill_task(stream_id)
    return jsonify({'status': 'ok', 'message': '正在发送停止信号...'})


@train_bp.route('/api/start_train/<owner>/<task_name>', methods=['POST'])
@login_required
def start_train(owner, task_name):
    if not check_perm(owner, task_name):
        return jsonify({'status': 'error', 'message': 'Permission Denied'}), 403

    # 检查是否已有任务在运行
    task_key = f"{owner}/{task_name}"
    if task_key in active_tasks_map:
        return jsonify({'status': 'error', 'message': '该任务已在后台运行中，请刷新页面查看进度'}), 400

    try:
        DATA_DIR = current_app.config['DATA_DIR']
        task_path = os.path.join(DATA_DIR, owner, task_name)
        if not os.path.isdir(task_path): return jsonify({'status': 'error', 'message': '项目不存在'}), 404

        # 【新增校验】获取参数并校验
        model_name = request.form.get('model')
        if not model_name:
            return jsonify({'status': 'error', 'message': '未选择模型 (Model is required)'}), 400

        params = {
            'model': model_name,  # 使用校验过的变量
            'epochs': int(request.form.get('epochs', 50)),
            'imgsz': int(request.form.get('imgsz', 640)),
            'batch': int(request.form.get('batch', 16)),
            'device': request.form.get('device', '0'),
            'train_ratio': float(request.form.get('train_ratio', 0.8)),
            'export_format': request.form.get('export_format', 'onnx'),
            'export_opset': int(request.form.get('export_opset', 17))
        }

        prep = prepare_dataset_for_training(task_path, params['train_ratio'])
        if not prep['success']: return jsonify({'status': 'error', 'message': prep['message']}), 500

        stream_id = str(uuid.uuid4())
        runs_dir = os.path.join(task_path, 'runs')
        os.makedirs(runs_dir, exist_ok=True)
        base_name = f"train_{int(time.time())}_{stream_id[:8]}"
        model_path = os.path.join(current_app.config['MODELS_FOLDER'], params['model'])

        safe_model_path = model_path.replace('\\', '/')
        safe_yaml_path = prep['yaml_path'].replace('\\', '/')
        safe_runs_dir = runs_dir.replace('\\', '/')

        # 构造训练脚本 (加入 stdout flush 保证日志实时)
        train_script = f"""
from ultralytics import YOLO
import sys
import signal

# 简单的信号处理，防止 Python 内部忽略信号
def signal_handler(sig, frame):
    print("Python script received signal, exiting...")
    sys.exit(0)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == '__main__':
    try:
        print("Initializing model...")
        model = YOLO(r'{safe_model_path}')
        print("Starting training loop...")

        # 训练
        model.train(
            data=r'{safe_yaml_path}',
            epochs={params["epochs"]},
            imgsz={params["imgsz"]},
            batch={params["batch"]},
            device='{params["device"]}',
            project=r'{safe_runs_dir}',
            name='{base_name}'
        )
    except Exception as e:
        print(f"Training Error: {{e}}")
        sys.exit(1)
"""
        cmd = [sys.executable, '-u', '-c', train_script]
        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"

        training_streams[stream_id] = []
        training_streams[stream_id].append(prep['message'])
        training_streams[stream_id].append(f"__QUEUED__")
        training_streams[stream_id].append("任务已加入队列，后台准备中...")

        # 注册活跃任务
        active_tasks_map[task_key] = stream_id

        task_data = {
            'stream_id': stream_id,
            'task_key': task_key,
            'cmd': cmd,
            'runs_dir': runs_dir,
            'base_name': base_name,
            'export_params': {'format': params['export_format'], 'opset': params['export_opset']},
            'env': env
        }
        task_queue.put(task_data)

        return jsonify({'status': 'ok', 'message': 'Started', 'stream_id': stream_id})

    except Exception as e:
        import traceback
        return jsonify({'status': 'error', 'message': traceback.format_exc()}), 500


@train_bp.route('/stream/<stream_id>')
@login_required
def stream(stream_id):
    """
    SSE 推送日志。
    【核心修复】: 去除了 GeneratorExit 时杀死进程的逻辑。
    """

    def event_stream():
        if stream_id not in training_streams:
            yield "data: __ERROR__:日志流不存在或已过期\n\n"
            yield "data: __END_OF_STREAM__\n\n"
            return

        last = 0
        try:
            while True:
                # 即使任务完成，也保留一段时间日志以便查看
                if stream_id not in training_streams:
                    break

                current_len = len(training_streams[stream_id])
                if last < current_len:
                    for i in range(last, current_len):
                        line = training_streams[stream_id][i]
                        yield f"data: {line}\n\n"
                        if "__END_OF_STREAM__" in line:
                            return
                    last = current_len

                time.sleep(1.0)  # 稍微增加间隔，减轻服务器压力

        except GeneratorExit:
            # 【修复点】 客户端断开连接（关闭页面/刷新）
            # 我们只是打印一下，绝对不杀进程
            print(f"👋 客户端断开日志连接 (后台任务 {stream_id} 继续运行)")
            return

        except Exception as e:
            print(f"Stream Error: {e}")
            yield f"data: __ERROR__:{str(e)}\n\n"

    return Response(event_stream(), mimetype='text/event-stream')


# List runs 和 Download 路由保持不变...
@train_bp.route('/api/list_runs/<owner>/<task_name>')
@login_required
def list_runs(owner, task_name):
    # (同你之前的代码)
    if not check_perm(owner, task_name): return jsonify([])
    DATA_DIR = current_app.config['DATA_DIR']
    base = os.path.join(DATA_DIR, owner, task_name, 'runs')
    runs = []
    if os.path.isdir(base):
        for d in os.listdir(base):
            try:
                runs.append({'name': d, 'mtime': int(os.path.getmtime(os.path.join(base, d)))})
            except:
                pass
    runs.sort(key=lambda x: x['mtime'], reverse=True)
    return jsonify(runs)


@train_bp.route('/api/download_results/<owner>/<task_name>/<run_name>')
@login_required
def download_results(owner, task_name, run_name):
    # (同你之前的代码)
    if not check_perm(owner, task_name): return "Denied", 403
    if not re.match(r'^[\w\-\.]+$', run_name): return "Invalid Name", 400
    DATA_DIR = current_app.config['DATA_DIR']
    res_dir = os.path.join(DATA_DIR, owner, task_name, 'runs', run_name)
    if not os.path.isdir(res_dir): return "Not found", 404
    archive_base = os.path.join(os.path.dirname(res_dir), f"{task_name}_{run_name}_results")
    archive_path = shutil.make_archive(base_name=archive_base, format='zip', root_dir=os.path.dirname(res_dir),
                                       base_dir=run_name)
    return send_from_directory(directory=os.path.dirname(archive_path), path=os.path.basename(archive_path),
                               as_attachment=True)