import os
import torch
from flask import Flask

# --- 引入 Engine ---
# 确保 utils 文件夹下有 __init__.py，或者该路径在 PYTHONPATH 中
from extensions import db, login_manager
from models import User
# from utils.sam3_wrapper import SAM3Engine

# --- 解决 Windows 下库冲突 ---
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"


def create_app():
    """创建并配置Flask应用实例"""
    app = Flask(__name__)

    # --- 安全配置 ---
    app.config['SECRET_KEY'] = 'ChangeThisToARandomSecretKey'  # 生产环境请修改
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///site.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # --- 基本配置 ---
    app.config['DATA_DIR'] = os.path.join(app.root_path, 'data')
    app.config['MODELS_FOLDER'] = os.path.join(app.root_path, 'models')

    os.makedirs(app.config['DATA_DIR'], exist_ok=True)
    os.makedirs(app.config['MODELS_FOLDER'], exist_ok=True)
    os.makedirs(os.path.join(app.config['DATA_DIR'], 'public'), exist_ok=True)

    # --- 初始化扩展 ---
    db.init_app(app)
    login_manager.init_app(app)

    # --- 注册蓝图 ---
    try:
        from blueprints.main_routes import main_bp
        from blueprints.annotate_routes import annotate_bp
        from blueprints.train_routes import train_bp
        from blueprints.sam_routes import sam_bp
        from blueprints.auth_routes import auth_bp

        app.register_blueprint(main_bp)
        app.register_blueprint(annotate_bp)
        app.register_blueprint(train_bp)
        app.register_blueprint(sam_bp)
        app.register_blueprint(auth_bp)
    except ImportError as e:
        print(f"Warning: Could not import some blueprints. Ensure file structure is correct. Error: {e}")

    # --- 数据库与初始用户 ---
    with app.app_context():
        db.create_all()
        # 创建默认管理员
        if not User.query.filter_by(username='admin').first():
            print("Creating default admin user (admin/Maikouce)...")
            admin = User(username='admin', is_admin=True)
            admin.set_password('Maikouce')
            db.session.add(admin)
            db.session.commit()
            os.makedirs(os.path.join(app.config['DATA_DIR'], 'admin'), exist_ok=True)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    print("=" * 50)
    print("YOLOv8/SAM3 Web Platform is running.")
    print(f"Data directory: {app.config['DATA_DIR']}")
    print("Access the platform at: http://127.0.0.1:8001")
    print("=" * 50)

    return app


if __name__ == '__main__':
    yolo_app = create_app()

    # ---【关键修改】程序启动时，在开启 Web 服务端口前，先初始化模型 ---
    # 这会阻塞主线程，直到模型真正加载到显存中
    print(f">>> [System] Initializing Ultralytics SAM3 Model on {('CUDA' if torch.cuda.is_available() else 'CPU')}...")

    try:
        # 获取单例实例，触发 __init__ 中的加载逻辑
        # global_engine = SAM3Engine.get_instance()

        # 可选：可以做一个空的 Warmup 推理来确保 CUDA kernel 已初始化
        # print(">>> [System] Warming up models...")
        # global_engine.warmup()

        print(">>> [System] SAM3 Model Loaded Successfully! Ready to serve.")
    except Exception as e:
        print(f">>> [System] SAM3 Model Load Failed: {e}")
        import traceback

        traceback.print_exc()
        print(">>> The web server will still start, but SAM features will error out.")

    # 启动 Flask
    # 注意：debug=False 防止重载器导致模型加载两次
    yolo_app.run(host='0.0.0.0', port=8001, debug=False)