from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class TaskPermission(db.Model):
    """
    仅用于控制 'public' 文件夹下的任务对哪些普通用户可见。
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    # owner_name 这里通常固定为 'public'，保留字段是为了以后扩展
    owner_name = db.Column(db.String(150), default='public', nullable=False) 
    task_name = db.Column(db.String(150), nullable=False)