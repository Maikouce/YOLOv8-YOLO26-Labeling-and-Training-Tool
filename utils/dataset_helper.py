# dataset_helper.py
import os
import shutil
import random
import yaml
import json


def prepare_dataset_for_training(task_path: str, train_ratio: float) -> dict:
    """
    为指定任务准备训练数据集。
    1. 查找所有图片和对应的标签。
    2. 按比例随机划分为训练集和验证集。
    3. 创建YOLOv5/v8所需的目录结构 (在 TrainData/ 子目录下)。
    4. 生成 data.yaml 文件。

    :param task_path: 任务的根目录路径。
    :param train_ratio: 训练集所占的比例 (0.0 to 1.0)。
    :return: 一个包含成功状态、消息和yaml文件路径的字典。
    """
    try:
        # --- 1. 定义路径和查找文件 ---
        output_base = os.path.join(task_path, "TrainData")
        if os.path.exists(output_base):
            shutil.rmtree(output_base)  # 清理旧的划分

        paths = {
            "train_images": os.path.join(output_base, "images", "train"),
            "val_images": os.path.join(output_base, "images", "val"),
            "train_labels": os.path.join(output_base, "labels", "train"),
            "val_labels": os.path.join(output_base, "labels", "val"),
        }
        for p in paths.values():
            os.makedirs(p, exist_ok=True)

        all_files = os.listdir(task_path)
        images = [f for f in all_files if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))]

        if not images:
            return {"success": False, "message": "错误：项目文件夹中没有找到任何图片。"}

        # --- 2. 划分数据集 ---
        random.shuffle(images)
        train_count = int(len(images) * train_ratio)
        train_images = images[:train_count]
        val_images = images[train_count:]

        log_messages = [f"共发现 {len(images)} 张图片。划分为 {len(train_images)} 训练集和 {len(val_images)} 验证集。"]

        # --- 3. 复制文件到新目录 ---
        def copy_files(image_list, dest_type):
            copied_count = 0
            for img_file in image_list:
                basename, _ = os.path.splitext(img_file)
                txt_file = basename + ".txt"

                src_img_path = os.path.join(task_path, img_file)
                src_txt_path = os.path.join(task_path, txt_file)

                if os.path.exists(src_txt_path):
                    shutil.copy(src_img_path, paths[f"{dest_type}_images"])
                    shutil.copy(src_txt_path, paths[f"{dest_type}_labels"])
                    copied_count += 1
            return copied_count

        train_copied = copy_files(train_images, "train")
        val_copied = copy_files(val_images, "val")

        log_messages.append(f"成功复制 {train_copied} 个带标签的训练样本。")
        log_messages.append(f"成功复制 {val_copied} 个带标签的验证样本。")

        if train_copied == 0 and val_copied == 0:
            return {"success": False, "message": "错误：所有图片都没有对应的.txt标签文件，无法进行训练。"}

        # --- 4. 生成 data.yaml ---
        labels_json_path = os.path.join(task_path, 'labels.json')
        if not os.path.exists(labels_json_path):
            return {"success": False, "message": "错误: 未找到 labels.json 文件，无法确定类别。"}

        with open(labels_json_path, 'r', encoding='utf-8') as f:
            labels_data = json.load(f)

        class_names = [label['name'] for label in labels_data]

        yaml_config = {
            'path': os.path.abspath(output_base),
            'train': 'images/train',
            'val': 'images/val',
            'nc': len(class_names),
            'names': class_names
        }

        yaml_path = os.path.join(output_base, 'data.yaml')
        with open(yaml_path, 'w', encoding='utf-8') as f:
            yaml.dump(yaml_config, f, sort_keys=False, allow_unicode=True)

        log_messages.append(f"成功生成 data.yaml 文件，包含 {len(class_names)} 个类别。")
        log_messages.append("数据准备完成，即将开始训练...")

        return {
            "success": True,
            "message": "\n".join(log_messages),
            "yaml_path": yaml_path
        }

    except Exception as e:
        import traceback
        return {"success": False, "message": f"数据准备过程中发生错误: {traceback.format_exc()}"}