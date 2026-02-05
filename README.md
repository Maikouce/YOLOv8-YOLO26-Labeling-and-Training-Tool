这是一个非常实用的计算机视觉工具项目。根据你提供的信息，我为你起草了一份专业的 `README.md` 文件。它突出了开源部分的实用性，同时也为你的进阶功能留下了引导。

---

# YOLO-SAM-WebUI：轻量级在线标注与训练平台 (部分开源版)

🚀 **一个基于 Flask + YOLOv8 + SAM3 的全流程视觉任务开发平台。**

本仓库提供了一个高度集成的 Web 环境，旨在解决计算机视觉开发者在“数据标注”与“模型训练”之间来回切换的痛点。你可以在浏览器中完成从图片上传、矩形框标注到模型训练、日志监控、结果导出的全部工作。

---

## 🌟 开源功能特性 (完全可用)

本次开源版本保留了平台最核心、最稳定的工作流，确保开发者可以立即上手进行生产：

-   **用户管理系统**：支持管理员创建用户、分配公共任务权限，适合小团队协作。
-   **矩形框标注 (Rect Annotation)**：
    *   **极速体验**：采用 Canvas 渲染，支持大图加载。
    *   **快捷键驱动**：支持 `Ctrl+C / Ctrl+V` 跨图复制粘贴标注框、数字键快速切换标签、`A/D` 翻页自动保存。
    *   **自然排序**：智能识别文件名（如 cam2.jpg 会排在 cam10.jpg 之前）。
-   **全自动训练管线 (YOLOv8/YOLO11)**：
    *   **一键训练**：自动完成数据集划分（Train/Val）、生成 YAML 配置文件。
    *   **实时监控**：通过 SSE 技术在网页端实时同步训练日志，内置 **Chart.js** 绘制 mAP、Loss 等曲线。
    *   **进程控制**：支持后台持久化训练，即使关闭网页任务也不会中断，并提供手动停止接口。
    *   **自动导出**：训练完成后自动将最佳模型转换为 ONNX 格式。
-   **数据管理**：支持批量上传、自然排序预览、标注结果 ZIP 一键下载。

---

## 🛠️ 技术栈

-   **后端**: Python 3.9+, Flask, Flask-SQLAlchemy, Flask-Login, PyTorch, Ultralytics
-   **前端**: 原生 JavaScript (ES6 Modules), Canvas API, Bootstrap 5, Chart.js
-   **算法**: YOLOv8 / YOLOv11

---

## 🚀 快速开始

### 1. 环境安装
```bash
# 克隆项目
git clone https://github.com/YourUsername/Auxiliary_annotation.git
cd Auxiliary_annotation

# 安装依赖
pip install -r requirements.txt
```

### 2. 模型准备
在项目根目录下创建 `models` 文件夹，并将你的 YOLOv8 预训练权重（如 `yolov8n.pt`）放入其中。

### 3. 运行程序
```bash
python app.py
```
访问地址：`http://127.0.0.1:8001`
默认管理员账号：`admin` 
默认管理员密码：`@XKRS1234`

---

## 💎 获取更多进阶功能 (商业/定制版)

为了维持项目的持续开发，部分高级辅助标注功能在开源版中仅做展示或代码保留。如果您需要解锁以下功能，欢迎联系作者获取：

1.  **SAM3 智能辅助标注**：点击、画框即可自动生成高精度分割掩码。
2.  **多边形/掩码标注 (Polygon)**：支持实例分割任务的精细化标注。
3.  **旋转框标注 (OBB)**：专为遥感、倾斜物体设计的旋转矩形框工具。
4.  **AI 自动标注中心**：利用 SAM3 提示词映射，实现全自动批量标注，数千张图片一键搞定。
5.  **语义模式切换**：支持提示词关联（Semantic）与单体分割（Standard）两种 AI 逻辑。

### 联系作者
如果你想进群交流、反馈 Bug 或咨询进阶版功能，请扫描下方二维码添加我的微信：
![微信二维码.png](%E4%BD%9C%E8%80%85%E8%81%94%E7%B3%BB%E6%96%B9%E5%BC%8F/%E5%BE%AE%E4%BF%A1%E4%BA%8C%E7%BB%B4%E7%A0%81.png)
完整版请看
https://www.bilibili.com/video/BV1gh6vBnES4/?spm_id_from=333.1387.homepage.video_card.click&vd_source=bca1c22721544bc54b9cabff893e7b70
> 
> *备注：标注平台*

---

## 📂 项目结构
```text
Auxiliary_annotation/
├── app.py              # 程序入口
├── models.py           # 数据库模型
├── extensions.py       # Flask 扩展初始化
├── blueprints/         # 路由蓝图（标注、训练、权限等）
├── static/             # 前端核心逻辑 (ES6 Modules)
│   ├── js/core/        # 画布、状态、交互管理
│   ├── js/annotators/  # 标注算法实现
│   └── js/pages/       # 页面逻辑入口
├── templates/          # HTML 模板
└── data/               # 默认数据存储目录
```

## 免责声明
本项目开源部分采用 [MIT] 许可证。使用本项目进行模型训练时，请确保您拥有数据集的所有权或合法使用权。

---

感谢支持！如果觉得好用，请点个 **Star** ⭐