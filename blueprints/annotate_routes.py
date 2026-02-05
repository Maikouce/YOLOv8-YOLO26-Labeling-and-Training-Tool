import os
import json
import base64
import math
import io
import zipfile
import mimetypes
import re  # 新增：用于正则表达式处理自然排序
from flask import Blueprint, request, jsonify, send_file, current_app, abort, render_template
from flask_login import login_required, current_user
from PIL import Image, ImageOps  # 修改引入 ImageOps
annotate_bp = Blueprint('annotate', __name__)

# --- 权限辅助 ---
from models import TaskPermission


def check_perm(owner, task_name):
    if current_user.is_admin: return True
    if owner == current_user.username: return True
    perm = TaskPermission.query.filter_by(user_id=current_user.id, owner_name=owner, task_name=task_name).first()
    return True if perm else False


def protect_route(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        owner = kwargs.get('owner') or request.form.get('owner') or (request.json and request.json.get('owner'))
        task_name = kwargs.get('task_name') or request.form.get('taskName') or (
                request.json and request.json.get('taskName')) or kwargs.get('taskName')
        if owner and task_name:
            if not check_perm(owner, task_name):
                return jsonify({"error": "Access Denied"}), 403
        return f(*args, **kwargs)

    return decorated


# --- 辅助函数 ---

def _natural_sort_key(s):
    """
    自然排序键值生成函数。
    将字符串拆分为文本和数字列表，例如 'cam10.jpg' -> ['cam', 10, '.jpg']
    这样比较时，数字部分会按数值大小比较，而不是按字符比较。
    """
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]


def _normalize_points(points, width, height, type_str):
    if width == 0 or height == 0: return []
    normalized = []
    try:
        if type_str == 'rect':
            cx, cy = (points['x'] + points['w'] / 2) / width, (points['y'] + points['h'] / 2) / height
            nw, nh = points['w'] / width, points['h'] / height
            normalized = [max(0, min(1, cx)), max(0, min(1, cy)), max(0, min(1, nw)), max(0, min(1, nh))]

        elif type_str == 'obb':
            # 【修复】保存为 YOLO OBB 标准的 4点坐标 (x1 y1 x2 y2 x3 y3 x4 y4)
            # 这样可以兼容 ultralytics yolo11-obb 训练
            cx, cy = points['x'], points['y']
            w, h = points['w'], points['h']
            rot = points['rotation']

            # 计算四个角点
            cos_a = math.cos(rot)
            sin_a = math.sin(rot)

            # 半宽和半高向量
            wx, wy = (w / 2) * cos_a, (w / 2) * sin_a
            hx, hy = - (h / 2) * sin_a, (h / 2) * cos_a

            # p1: tl, p2: tr, p3: br, p4: bl (相对于旋转后的方向)
            # 注意：这里计算出的是绝对像素坐标的偏移量
            corners = [
                (cx - wx - hx, cy - wy - hy),
                (cx + wx - hx, cy + wy - hy),
                (cx + wx + hx, cy + wy + hy),
                (cx - wx + hx, cy - wy + hy)
            ]

            # 归一化并展平
            for px, py in corners:
                normalized.extend([
                    max(0, min(1, px / width)),
                    max(0, min(1, py / height))
                ])

        elif type_str == 'polygon':
            for x, y in points:
                normalized.extend([max(0, min(1, x / width)), max(0, min(1, y / height))])
    except Exception as e:
        print(f"Error normalizing points: {e}")
        return []
    return normalized


def _parse_yolo_annotations(txt_path, width, height, labels):
    annotations = []
    if not os.path.exists(txt_path): return annotations

    label_map = {idx: label['name'] for idx, label in enumerate(labels)}
    label_color_map = {label['name']: label['color'] for label in labels}

    try:
        with open(txt_path, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split()
                if not parts: continue
                try:
                    class_index = int(parts[0])
                except ValueError:
                    continue

                label_name = label_map.get(class_index, f"class_{class_index}")
                label_color = label_color_map.get(label_name, "#FF0000")

                try:
                    coords = [float(p) for p in parts[1:]]
                except ValueError:
                    continue

                # --- 矩形 (Rect) ---
                if len(coords) == 4:
                    w, h = coords[2] * width, coords[3] * height
                    x, y = (coords[0] * width) - (w / 2), (coords[1] * height) - (h / 2)
                    annotations.append({"type": "rect", "label": label_name, "color": label_color,
                                        "points": {"x": x, "y": y, "w": w, "h": h}})

                # --- 旧版 OBB (XYWHR 5个参数) ---
                # 兼容你现有的报错数据，以便在前端能加载出来进行修改
                elif len(coords) == 5:
                    annotations.append({"type": "obb", "label": label_name, "color": label_color,
                                        "points": {"x": coords[0] * width, "y": coords[1] * height,
                                                   "w": coords[2] * width, "h": coords[3] * height,
                                                   "rotation": coords[4]}})

                # --- 新版 OBB / 多边形 (8个参数) ---
                # 如果是 8 个坐标 (4个点)，我们将其解析为 OBB，以便前端 OBBAnnotator 编辑
                elif len(coords) == 8:
                    # 还原 4个点 (x1,y1...x4,y4)
                    pts = [(coords[i] * width, coords[i + 1] * height) for i in range(0, 8, 2)]

                    # 1. 计算中心点
                    cx = sum(p[0] for p in pts) / 4
                    cy = sum(p[1] for p in pts) / 4

                    # 2. 计算边长 (假设 pts[0]->pts[1] 是宽，pts[1]->pts[2] 是高)
                    # 即使不是，OBB 只要形状对即可
                    edge1 = math.sqrt((pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2)
                    edge2 = math.sqrt((pts[2][0] - pts[1][0]) ** 2 + (pts[2][1] - pts[1][1]) ** 2)

                    # 3. 计算旋转角度 (基于第一条边)
                    rotation = math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])

                    annotations.append({
                        "type": "obb",
                        "label": label_name,
                        "color": label_color,
                        "points": {
                            "x": cx, "y": cy,
                            "w": edge1, "h": edge2,
                            "rotation": rotation
                        }
                    })

                # --- 其他多边形 ---
                elif len(coords) > 8:
                    pts = [[coords[i] * width, coords[i + 1] * height] for i in range(0, len(coords), 2) if
                           i + 1 < len(coords)]
                    annotations.append({"type": "polygon", "label": label_name, "color": label_color, "points": pts})

    except Exception as e:
        current_app.logger.error(f"Parse error {txt_path}: {e}")
    return annotations


# --- 路由定义 ---

@annotate_bp.route('/annotate/<owner>/<task_name>')
@login_required
def annotate_default_page(owner, task_name):
    if not check_perm(owner, task_name): abort(403)
    return annotate_typed_page(owner, task_name, 'rect')


@annotate_bp.route('/annotate/<owner>/<task_name>/<type>')
@login_required
def annotate_typed_page(owner, task_name, type):
    if not check_perm(owner, task_name): abort(403)
    template_map = {
        'rect': 'annotate_Rect.html',
        'polygon': 'annotate_Polygon.html',
        'obb': 'annotate_OBB.html'
    }
    if type not in template_map:
        return jsonify({"error": f"不支持的标注类型: {type}"}), 400

    return render_template(template_map[type], owner=owner, task_name=task_name, user=current_user)


@annotate_bp.route('/api/task_data/<owner>/<task_name>', methods=['GET'])
@login_required
@protect_route
def get_task_data(owner, task_name):
    """
    获取任务所有图片的元数据。
    优化：尽量减少 PIL 打开图片的开销，但为了获得宽高，如果是首次加载可能较慢。
    **修改：应用自然排序 (Natural Sort)，使 cam2 排在 cam10 之前。**
    """
    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, task_name)
    if not os.path.isdir(task_path): return jsonify({"error": "任务不存在"}), 404

    labels = []
    labels_path = os.path.join(task_path, 'labels.json')
    if os.path.exists(labels_path):
        try:
            with open(labels_path, 'r', encoding='utf-8') as f:
                labels = json.load(f)
        except:
            labels = []

    images_data = []
    # 只列出图片文件
    valid_exts = {'.png', '.jpg', '.jpeg', '.bmp', '.webp'}
    try:
        all_files = os.listdir(task_path)
    except OSError:
        return jsonify({"error": "无法读取任务目录"}), 500

    # 筛选出图片
    filtered_files = [f for f in all_files if os.path.splitext(f)[1].lower() in valid_exts]

    # 关键修改：使用 natural_sort_key 进行排序
    image_files = sorted(filtered_files, key=_natural_sort_key)

    for filename in image_files:
        image_path = os.path.join(task_path, filename)
        txt_path = os.path.splitext(image_path)[0] + '.txt'

        width, height = 0, 0
        try:
            # 优化：Image.open 是惰性的，只要不 load 数据，读取头部信息很快
            with Image.open(image_path) as img:
                width, height = img.size
        except Exception:
            # 如果图片损坏，跳过而不是崩溃
            continue

        annotations = _parse_yolo_annotations(txt_path, width, height, labels)
        images_data.append(
            {"name": filename, "originalWidth": width, "originalHeight": height, "annotations": annotations})

    return jsonify({"labels": labels, "images": images_data})


@annotate_bp.route('/api/image_data/<owner>/<task_name>/<image_name>', methods=['GET'])
@login_required
@protect_route
def get_image_data(owner, task_name, image_name):
    """
    获取单张图片数据和标注。
    新增功能：支持 meta_only=true 参数，只返回标注数据，不返回图片 Base64，
    用于前端缓存命中时的快速数据同步。
    """
    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, task_name)
    image_path = os.path.join(task_path, image_name)
    txt_path = os.path.splitext(image_path)[0] + '.txt'

    # 检查 meta_only 参数
    meta_only = request.args.get('meta_only') == 'true'

    if not os.path.exists(image_path): return jsonify({"error": "图片不存在"}), 404

    # 1. 获取标签
    labels = []
    labels_file = os.path.join(task_path, 'labels.json')
    if os.path.exists(labels_file):
        try:
            with open(labels_file, 'r', encoding='utf-8') as f:
                labels = json.load(f)
        except:
            pass

    # 2. 获取图片宽高 (PIL Lazy Open)
    # 即使是 meta_only 模式也需要宽高来反归一化坐标
    width, height = 0, 0
    try:
        with Image.open(image_path) as img:
            width, height = img.size
    except Exception as e:
        return jsonify({"error": f"Invalid image: {str(e)}"}), 500

    # 3. 解析标注
    annotations = _parse_yolo_annotations(txt_path, width, height, labels)

    # --- 修复核心：如果是仅获取元数据，直接返回，不读取图片流 ---
    if meta_only:
        return jsonify({
            "data": None,  # 不传输图片数据
            "annotations": annotations,
            "originalWidth": width,
            "originalHeight": height,
            "meta_only": True
        })

    # 4. 极速 Base64 读取 (原逻辑)
    try:
        with open(image_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')

        mime_type, _ = mimetypes.guess_type(image_path)
        if not mime_type: mime_type = 'image/jpeg'

        img_data_str = f"data:{mime_type};base64,{encoded_string}"
    except Exception as e:
        return jsonify({"error": f"Read error: {str(e)}"}), 500

    return jsonify({
        "data": img_data_str,
        "annotations": annotations,
        "originalWidth": width,
        "originalHeight": height
    })

@annotate_bp.route('/api/raw_image/<owner>/<task_name>/<image_name>')
@login_required
@protect_route
def serve_raw_image(owner, task_name, image_name):
    """
    新增接口：直接提供原生图片流。
    这允许浏览器进行原生缓存和内存管理，彻底解决 Base64 内存泄漏问题。
    前端可以通过 <img src="/api/raw_image/..."> 来加载。
    """
    DATA_DIR = current_app.config['DATA_DIR']
    image_path = os.path.join(DATA_DIR, owner, task_name, image_name)
    if not os.path.exists(image_path):
        abort(404)
    return send_file(image_path)


@annotate_bp.route('/api/save_annotation', methods=['POST'])
@login_required
@protect_route
def save_annotation():
    data = request.json
    owner, task_name = data.get('owner'), data.get('taskName')
    image_name = data.get('imageName')
    img_width, img_height = data.get('imageWidth'), data.get('imageHeight')
    annotations, labels = data.get('annotations', []), data.get('labels', [])

    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, task_name)
    os.makedirs(task_path, exist_ok=True)

    # 原子写入标签文件防止损坏

    # 保存标签
    try:
        with open(os.path.join(task_path, 'labels.json'), 'w', encoding='utf-8') as f:
            json.dump(labels, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return jsonify({"error": f"Save labels failed: {e}"}), 500

    # 保存 TXT
    label_to_index = {label['name']: i for i, label in enumerate(labels)}
    yolo_strings = []

    for ann in annotations:
        if 'label' not in ann or ann['label'] not in label_to_index: continue
        idx = label_to_index[ann['label']]

        try:
            pts = _normalize_points(ann['points'], img_width, img_height, ann['type'])
            if not pts: continue
            # 格式化字符串，减少小数点位数节省空间
            coord_str = " ".join([f"{p:.6f}" for p in pts])
            yolo_strings.append(f"{idx} {coord_str}")
        except Exception:
            continue

    txt_filename = os.path.splitext(image_name)[0] + '.txt'
    txt_full_path = os.path.join(task_path, txt_filename)

    try:
        with open(txt_full_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(yolo_strings))
    except Exception as e:
        return jsonify({"error": f"Save annotation failed: {e}"}), 500

    return jsonify({"message": "Saved", "imageName": image_name}), 200


@annotate_bp.route('/api/save_labels', methods=['POST'])
@login_required
@protect_route
def save_labels():
    data = request.json
    owner, task_name = data.get('owner'), data.get('taskName')
    labels = data.get('labels', [])
    DATA_DIR = current_app.config['DATA_DIR']
    try:
        with open(os.path.join(DATA_DIR, owner, task_name, 'labels.json'), 'w', encoding='utf-8') as f:
            json.dump(labels, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"message": "Labels saved"}), 200


@annotate_bp.route('/api/upload_dataset', methods=['POST'])
@login_required
def upload_dataset():
    owner = request.form.get('owner')
    task_name = request.form.get('taskName')

    if not check_perm(owner, task_name):
        return jsonify({"error": "Access Denied"}), 403

    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, task_name)
    os.makedirs(task_path, exist_ok=True)

    uploaded_files = request.files.getlist('files')
    if not uploaded_files: return jsonify({"message": "No files"}), 200

    labels_path = os.path.join(task_path, 'labels.json')
    labels = []
    if os.path.exists(labels_path):
        try:
            with open(labels_path, 'r', encoding='utf-8') as f:
                labels = json.load(f)
        except:
            pass

    import random
    def random_bright_color():
        return f"hsl({random.randint(0, 360)}, {random.randint(70, 100)}%, {random.randint(45, 60)}%)"

    saved_img, saved_txt = 0, 0
    temp_ids = set()

    for file in uploaded_files:
        fn = file.filename
        if not fn: continue

        ext = os.path.splitext(fn)[1].lower()
        save_path = os.path.join(task_path, fn)

        if ext in ['.png', '.jpg', '.jpeg', '.bmp', '.webp']:
            # --- 【核心修改开始】 ---
            try:
                # 1. 使用 PIL 打开上传的文件流
                img = Image.open(file)

                # 2. 关键步骤：根据 EXIF 信息物理旋转图片像素
                # 这会处理 Windows 资源管理器看着是正的，但 Canvas 读取是倒着的问题
                img = ImageOps.exif_transpose(img)

                # 3. 格式兼容性处理
                # 如果是 RGBA (透明通道) 保存为 JPG 会报错，需转为 RGB
                if ext in ['.jpg', '.jpeg'] and img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')

                # 4. 保存处理后的图片 (quality=95 保证高质量)
                # 此时保存的图片，宽高已经互换（如果原本是旋转的话），且没有 EXIF Orientation 标签
                img.save(save_path, quality=95)
                saved_img += 1
            except Exception as e:
                print(f"Error processing image rotation {fn}: {e}")
                # 如果 PIL 处理失败（比如文件损坏），回退到直接保存原始流
                file.seek(0)
                file.save(save_path)
                saved_img += 1
            # --- 【核心修改结束】 ---

        elif ext == '.txt':
            # 读取内容以发现新的 class id
            try:
                content = file.read()
                file.seek(0)
                file.save(save_path)
                saved_txt += 1
                for line in content.decode('utf-8', errors='ignore').splitlines():
                    p = line.strip().split()
                    if p and p[0].isdigit(): temp_ids.add(int(p[0]))
            except:
                pass
        elif ext == '.json':
            # 如果上传了 labels.json，合并或覆盖
            if fn == 'labels.json':
                file.save(save_path)
            else:
                file.save(save_path)

    # 自动生成缺失的标签定义
    if temp_ids:
        max_id = max(temp_ids)
        current_max = len(labels) - 1
        if max_id > current_max:
            for i in range(current_max + 1, max_id + 1):
                labels.append({"name": f"class_{i}", "color": random_bright_color(), "attributes": []})
            with open(labels_path, 'w', encoding='utf-8') as f:
                json.dump(labels, f, ensure_ascii=False, indent=2)

    return jsonify({"message": f"Done. Img:{saved_img}, Txt:{saved_txt} (Auto-Rotated)", "labelsUpdated": True}), 200


@annotate_bp.route('/api/delete_images', methods=['POST'])
@login_required
@protect_route
def delete_images():
    data = request.json
    owner, task_name = data.get('owner'), data.get('taskName')
    image_names = data.get('imageNames', [])
    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, task_name)
    c = 0
    for name in image_names:
        try:
            # 简单的路径遍历保护
            if '..' in name or '/' in name or '\\' in name: continue

            ip = os.path.join(task_path, name)
            tp = os.path.splitext(ip)[0] + '.txt'

            if os.path.exists(ip):
                os.remove(ip)
                c += 1
            if os.path.exists(tp): os.remove(tp)
        except Exception as e:
            print(f"Delete error: {e}")
            pass
    return jsonify({"message": f"Deleted {c}"}), 200


@annotate_bp.route('/api/download/<owner>/<task_name>', methods=['GET'])
@login_required
def download_task(owner, task_name):
    if not check_perm(owner, task_name):
        return jsonify({"error": "Access Denied"}), 403

    DATA_DIR = current_app.config['DATA_DIR']
    task_path = os.path.join(DATA_DIR, owner, task_name)
    if not os.path.isdir(task_path): return "Not found", 404

    # 使用内存流，避免生成临时文件
    memory_file = io.BytesIO()
    try:
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(task_path):
                for item in files:
                    if item.lower().endswith(('.png', '.jpg', '.jpeg', '.txt', '.json', '.bmp', '.yaml', '.webp')):
                        abs_path = os.path.join(root, item)
                        rel_path = os.path.relpath(abs_path, task_path)
                        zf.write(abs_path, arcname=rel_path)
    except Exception as e:
        return jsonify({"error": f"Zip failed: {e}"}), 500

    memory_file.seek(0)
    return send_file(memory_file, download_name=f'{task_name}_dataset.zip', as_attachment=True)