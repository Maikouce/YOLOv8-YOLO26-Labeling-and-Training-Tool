import os
import re
import shutil
from functools import wraps
from flask import Blueprint, render_template, jsonify, current_app, request
from flask_login import login_required, current_user
from models import TaskPermission

main_bp = Blueprint('main', __name__)

NAME_RE = re.compile(r'^[A-Za-z0-9_\-\u4e00-\u9fff ]+$')


def is_valid_name(name: str) -> bool:
    if not name or not isinstance(name, str): return False
    if '..' in name or '/' in name or '\\' in name: return False
    return bool(NAME_RE.match(name))


# --- 权限校验装饰器 (修复版) ---
def verify_access(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 【修复重点】：使用 get_json(silent=True) 防止 GET 请求报 415 错误
        json_data = request.get_json(silent=True) or {}

        # 依次从 URL参数、JSON body、Form表单 中尝试获取 owner 和 taskName
        owner = kwargs.get('owner') or json_data.get('owner') or request.form.get('owner')
        task_name = kwargs.get('taskName') or json_data.get('taskName') or request.form.get('taskName') or kwargs.get(
            'task_name')

        # 如果连 owner 都没有，通常是全局接口，放行（或根据业务拦截）
        if not owner:
            return f(*args, **kwargs)

        # 1. 管理员无视规则，可以访问任何人的 owner
        if current_user.is_admin:
            return f(*args, **kwargs)

        # 2. 访问自己的目录 -> 允许
        if owner == current_user.username:
            return f(*args, **kwargs)

        # 3. 访问 Public 目录 -> 需要更细致的检查
        if owner == 'public':
            # 如果只是 GET 请求获取任务列表 (main.get_tasks)，允许通过
            # 因为 get_tasks 内部还有一层过滤逻辑，只返回用户可见的任务
            if request.method == 'GET' and request.endpoint == 'main.get_tasks':
                return f(*args, **kwargs)

            # 如果是具体操作某个任务 (删除、修改、标注、上传)
            if task_name:
                # 检查数据库 TaskPermission 表
                perm = TaskPermission.query.filter_by(
                    user_id=current_user.id,
                    owner_name='public',
                    task_name=task_name
                ).first()
                if perm:
                    return f(*args, **kwargs)

        # 4. 其他情况一律拒绝（例如普通用户想访问别人的目录）
        return jsonify({"error": "Access Denied: You cannot access this owner."}), 403

    return decorated_function


@main_bp.route('/')
@login_required
def index():
    return render_template('index.html', user=current_user)


@main_bp.route('/tasks/<owner>')
@login_required
def task_page(owner):
    # 简单的页面渲染权限检查
    if not current_user.is_admin:
        # 普通用户只能进自己 或 public
        if owner != current_user.username and owner != 'public':
            return render_template('index.html', error="无权访问该区域")
    return render_template('tasks.html', owner=owner, user=current_user)


@main_bp.route('/api/owners', methods=['GET'])
@login_required
def get_owners():
    """
    获取所有者列表：
    - 管理员：返回物理文件夹下的所有 owners。
    - 普通用户：只返回 [自己的用户名, 'public']。
    """
    DATA_DIR = current_app.config['DATA_DIR']

    # 确保基础目录存在 (自愈)
    public_path = os.path.join(DATA_DIR, 'public')
    user_path = os.path.join(DATA_DIR, current_user.username)
    os.makedirs(public_path, exist_ok=True)
    os.makedirs(user_path, exist_ok=True)

    if current_user.is_admin:
        # 管理员看到所有物理文件夹
        owners = [d for d in os.listdir(DATA_DIR) if os.path.isdir(os.path.join(DATA_DIR, d))]
        owners.sort()
        return jsonify(owners)
    else:
        # 普通用户只能看到自己和 public，绝对看不到其他人
        visible_owners = [current_user.username, 'public']
        return jsonify(visible_owners)


@main_bp.route('/api/tasks/<owner>', methods=['GET'])
@login_required
@verify_access
def get_tasks(owner):
    """
    获取任务列表：
    - owner == self: 返回物理文件夹所有任务。
    - owner == 'public':
        - Admin: 返回所有物理任务。
        - User: 查 DB，只返回被授权的任务名。
    """
    DATA_DIR = current_app.config['DATA_DIR']
    owner_path = os.path.join(DATA_DIR, owner)

    if not os.path.exists(owner_path):
        return jsonify([])

    # 获取物理文件列表
    try:
        physical_tasks = [d for d in os.listdir(owner_path) if os.path.isdir(os.path.join(owner_path, d))]
    except OSError:
        return jsonify([])

    # 逻辑过滤
    if current_user.is_admin:
        # 管理员看一切
        physical_tasks.sort()
        return jsonify(physical_tasks)

    if owner == current_user.username:
        # 自己看自己的一切
        physical_tasks.sort()
        return jsonify(physical_tasks)

    if owner == 'public':
        # public 目录：只看授权的
        perms = TaskPermission.query.filter_by(user_id=current_user.id, owner_name='public').all()
        allowed_task_names = set(p.task_name for p in perms)

        # 取交集：物理存在的 AND 授权的
        visible_tasks = [t for t in physical_tasks if t in allowed_task_names]
        visible_tasks.sort()
        return jsonify(visible_tasks)

    return jsonify([])


@main_bp.route('/api/tasks/create', methods=['POST'])
@login_required
@verify_access
def create_task():
    data = request.get_json(silent=True) or {}
    owner = data.get('owner', '')
    taskName = data.get('taskName', '')

    # 严格限制：普通用户只能在自己的目录下创建
    if not current_user.is_admin and owner != current_user.username:
        return jsonify({"error": "你只能在自己的目录下创建任务"}), 403

    if not is_valid_name(owner) or not is_valid_name(taskName):
        return jsonify({"error": "名称无效"}), 400

    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, taskName)

    try:
        os.makedirs(task_path, exist_ok=True)
        os.makedirs(os.path.join(task_path, 'images'), exist_ok=True)
        os.makedirs(os.path.join(task_path, 'labels'), exist_ok=True)
        return jsonify({"success": True}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@main_bp.route('/api/tasks/delete', methods=['POST'])
@login_required
@verify_access
def delete_task():
    data = request.get_json(silent=True) or {}
    owner = data.get('owner', '')
    taskName = data.get('taskName', '')

    # 严格限制：普通用户不能删除 public 下的任务
    if owner == 'public' and not current_user.is_admin:
        return jsonify({"error": "只有管理员可以删除公共任务"}), 403

    # 普通用户不能删除别人的任务
    if owner != current_user.username and not current_user.is_admin:
        return jsonify({"error": "无权删除"}), 403

    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, taskName)

    if os.path.exists(task_path):
        try:
            shutil.rmtree(task_path)
            # 清理权限记录
            if owner == 'public':
                TaskPermission.query.filter_by(owner_name='public', task_name=taskName).delete()
                from extensions import db
                db.session.commit()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    else:
        return jsonify({"error": "任务不存在"}), 404


@main_bp.route('/api/owners/delete', methods=['POST'])
@login_required
def delete_owner():
    # 只有管理员能删除所有者
    if not current_user.is_admin:
        return jsonify({"error": "权限不足"}), 403

    data = request.get_json(silent=True) or {}
    owner = data.get('owner', '')

    if owner in ['public', 'admin']:
        return jsonify({"error": "无法删除系统保留目录"}), 400

    DATA_DIR = current_app.config['DATA_DIR']
    owner_path = os.path.join(DATA_DIR, owner)

    if os.path.exists(owner_path):
        try:
            shutil.rmtree(owner_path)
            # 同时删除用户账号
            from extensions import db
            from models import User
            u = User.query.filter_by(username=owner).first()
            if u:
                db.session.delete(u)
                db.session.commit()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify({"error": "所有者不存在"}), 404