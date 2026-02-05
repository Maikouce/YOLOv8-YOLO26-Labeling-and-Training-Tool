# blueprints/sam_routes.py
import os
from collections import defaultdict
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from utils.AI_wrapper import SAM3Engine
from models import TaskPermission

sam_bp = Blueprint('sam', __name__)


def get_engine():
    return SAM3Engine.get_instance()


def check_perm(owner, task_name):
    if current_user.is_admin: return True
    if owner == current_user.username: return True
    perm = TaskPermission.query.filter_by(user_id=current_user.id, owner_name=owner, task_name=task_name).first()
    return True if perm else False


@sam_bp.route('/api/sam/predict', methods=['POST'])
@login_required
def sam_predict():
    data = request.json
    owner = data.get('owner')
    task_name = data.get('taskName')

    if not check_perm(owner, task_name):
        return jsonify({"error": "Access Denied"}), 403

    image_name = data.get('imageName')
    prompts = data.get('prompts', [])
    confidence = float(data.get('confidence', 0.25))
    # 【新增】获取 samMode，默认为 semantic
    sam_mode = data.get('samMode', 'semantic')

    DATA_DIR = current_app.config['DATA_DIR']
    image_path = os.path.join(DATA_DIR, owner, task_name, image_name)
    engine = get_engine()

    groups = defaultdict(lambda: {
        'boxes': [], 'box_labels': [],
        'points': [], 'point_labels': [],
        'color': None, 'rotation': 0
    })

    for p in prompts:
        label = p['label']
        g = groups[label]
        is_neg = p.get('isNegative', False)

        if not is_neg:
            g['color'] = p['color']
        elif g['color'] is None:
            g['color'] = p['color']

        if p.get('rotation', 0) != 0: g['rotation'] = p['rotation']

        if p['type'] == 'box':
            g['boxes'].append(p['data'])
            g['box_labels'].append(0 if is_neg else 1)
        elif p['type'] == 'point':
            g['points'].append(p['data'])
            g['point_labels'].append(0 if is_neg else 1)

    generated_annotations = []

    try:
        for label_name, g in groups.items():
            if not g['boxes'] and not g['points']: continue

            results = engine.predict_mixed(
                image_path,
                bboxes=g['boxes'],
                bbox_labels=g['box_labels'],
                points=g['points'],
                point_labels=g['point_labels'],
                text_prompt=label_name,
                conf_thres=confidence,
                sam_mode=sam_mode  # 【新增】传入模式
            )

            for res in results:
                final_label = label_name
                if g['rotation'] != 0:
                    final_label = f"{label_name}:::{g['rotation']}"

                generated_annotations.append({
                    "type": "polygon",
                    "label": final_label,
                    "color": g['color'],
                    "points": res['points']
                })

        return jsonify({"success": True, "annotations": generated_annotations})
    except Exception as e:
        print(f"SAM Predict Error: {e}")
        return jsonify({"error": str(e)}), 500


@sam_bp.route('/api/sam/auto_annotate', methods=['POST'])
@login_required
def sam_auto_annotate():
    data = request.json
    owner = data.get('owner')
    task_name = data.get('taskName')

    if not check_perm(owner, task_name):
        return jsonify({"error": "Access Denied"}), 403

    image_name = data.get('imageName')
    prompt_config = data.get('promptConfig', [])
    confidence = float(data.get('confidence', 0.25))

    DATA_DIR = current_app.config['DATA_DIR']
    image_path = os.path.join(DATA_DIR, owner, task_name, image_name)
    engine = get_engine()

    texts = [item['text'] for item in prompt_config]

    try:
        results = engine.predict_text(image_path, texts, conf_thres=confidence)
        final_anns = []

        for res in results:
            cfg = next((c for c in prompt_config if c['text'] == res['label_text']), None)
            if cfg:
                final_anns.append({
                    "type": "polygon",
                    "label": cfg['label'],
                    "color": cfg['color'],
                    "points": res['points']
                })

        return jsonify({"success": True, "annotations": final_anns})
    except Exception as e:
        print(f"SAM Auto Annotate Error: {e}")
        return jsonify({"error": str(e)}), 500