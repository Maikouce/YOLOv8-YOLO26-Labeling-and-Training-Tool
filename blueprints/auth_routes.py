from flask import Blueprint, render_template, redirect, url_for, request, flash, jsonify, current_app
from flask_login import login_user, logout_user, login_required, current_user
from extensions import db
from models import User, TaskPermission
import os

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.is_json:
            data = request.json
            username = data.get('username')
            password = data.get('password')
        else:
            username = request.form.get('username')
            password = request.form.get('password')

        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)

            # --- 【新增】核心逻辑：登录时确保用户的物理目录存在 ---
            user_dir = os.path.join(current_app.config['DATA_DIR'], user.username)
            if not os.path.exists(user_dir):
                try:
                    os.makedirs(user_dir, exist_ok=True)
                    print(f"Directory recreated for user: {user.username}")
                except Exception as e:
                    print(f"Failed to create directory for {user.username}: {e}")
            # -----------------------------------------------------

            if request.is_json:
                return jsonify({"success": True, "user": {"username": user.username, "is_admin": user.is_admin}})
            return redirect(url_for('main.index'))
        else:
            if request.is_json:
                return jsonify({"error": "用户名或密码错误"}), 401
            flash('用户名或密码错误', 'danger')

    return render_template('login.html')


@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('auth.login'))


@auth_bp.route('/api/current_user')
@login_required
def get_current_user_info():
    return jsonify({
        "id": current_user.id,
        "username": current_user.username,
        "is_admin": current_user.is_admin
    })


# --- 管理员接口 ---

@auth_bp.route('/admin')
@login_required
def admin_panel():
    if not current_user.is_admin:
        return redirect(url_for('main.index'))
    return render_template('admin.html')


@auth_bp.route('/api/admin/create_user', methods=['POST'])
@login_required
def create_user():
    if not current_user.is_admin:
        return jsonify({"error": "权限不足"}), 403

    data = request.json
    username = data.get('username')
    password = data.get('password')
    is_admin = data.get('is_admin', False)

    if User.query.filter_by(username=username).first():
        return jsonify({"error": "用户已存在"}), 400

    # 1. 创建数据库记录
    new_user = User(username=username, is_admin=is_admin)
    new_user.set_password(password)
    db.session.add(new_user)

    # 2. 立即创建物理文件夹
    user_data_path = os.path.join(current_app.config['DATA_DIR'], username)
    os.makedirs(user_data_path, exist_ok=True)

    db.session.commit()
    return jsonify({"success": True})


@auth_bp.route('/api/admin/users', methods=['GET'])
@login_required
def list_users():
    if not current_user.is_admin: return jsonify([]), 403
    users = User.query.all()
    return jsonify([{"id": u.id, "username": u.username, "is_admin": u.is_admin} for u in users])


# --- 权限管理接口 (用于 Admin 面板) ---

@auth_bp.route('/api/admin/public_tasks', methods=['GET'])
@login_required
def list_public_tasks():
    """列出 public 文件夹下的所有任务 (供管理员选择授权)"""
    if not current_user.is_admin: return jsonify([]), 403

    DATA_DIR = current_app.config['DATA_DIR']
    public_path = os.path.join(DATA_DIR, 'public')
    if not os.path.exists(public_path):
        os.makedirs(public_path, exist_ok=True)
        return jsonify([])

    tasks = [d for d in os.listdir(public_path) if os.path.isdir(os.path.join(public_path, d))]
    tasks.sort()
    return jsonify(tasks)


@auth_bp.route('/api/admin/permissions', methods=['GET'])
@login_required
def list_permissions():
    """列出当前的授权记录"""
    if not current_user.is_admin: return jsonify([]), 403

    perms = TaskPermission.query.all()
    result = []
    for p in perms:
        u = User.query.get(p.user_id)
        if u:
            result.append({
                "id": p.id,
                "username": u.username,
                "task_name": p.task_name,
                "owner": p.owner_name
            })
    return jsonify(result)


@auth_bp.route('/api/admin/grant_permission', methods=['POST'])
@login_required
def grant_permission():
    if not current_user.is_admin: return jsonify({"error": "权限不足"}), 403

    data = request.json
    username = data.get('username')
    task_name = data.get('task_name')

    user = User.query.filter_by(username=username).first()
    if not user: return jsonify({"error": "用户不存在"}), 404

    # 检查任务是否存在于 public
    public_task_path = os.path.join(current_app.config['DATA_DIR'], 'public', task_name)
    if not os.path.exists(public_task_path):
        return jsonify({"error": "公共任务不存在"}), 404

    exists = TaskPermission.query.filter_by(user_id=user.id, owner_name='public', task_name=task_name).first()
    if not exists:
        perm = TaskPermission(user_id=user.id, owner_name='public', task_name=task_name)
        db.session.add(perm)
        db.session.commit()

    return jsonify({"success": True})


@auth_bp.route('/api/admin/revoke_permission', methods=['POST'])
@login_required
def revoke_permission():
    if not current_user.is_admin: return jsonify({"error": "权限不足"}), 403

    perm_id = request.json.get('id')
    TaskPermission.query.filter_by(id=perm_id).delete()
    db.session.commit()
    return jsonify({"success": True})