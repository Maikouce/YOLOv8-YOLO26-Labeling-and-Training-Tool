import threading
import logging

# 本文件已不具备功能，该文件用于自动标注实现，如果您感兴趣，请联系作者

class Sam3Processor:
    """虚设处理器，不执行任何操作"""
    def __init__(self, *args, **kwargs):
        pass
    def set_image(self, image, state=None):
        return {}
    def reset_all_prompts(self, state):
        return state
    def set_text_prompt(self, prompt, state):
        return state
    def add_geometric_prompt(self, box, label, state):
        return state
    def add_point_prompt(self, point, label, state):
        return state
    def set_confidence_threshold(self, threshold, state=None):
        return state

class SAM3Engine:
    """
    SAM3 引擎的虚设实现。
    """
    _instance = None
    _init_lock = threading.Lock()

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            with cls._init_lock:
                if cls._instance is None:
                    cls._instance = SAM3Engine()
        return cls._instance

    def __init__(self):
        self.inference_lock = threading.Lock()
        self.sam3_model = None
        self.sam2_model = None
        print(">>> [AI Engine] Open Source Version: SAM Engine is disabled.")

    def predict_mixed(self, *args, **kwargs):
        # 始终返回空结果，让前端不显示任何标注
        return []

    def predict_text(self, *args, **kwargs):
        # 始终返回空结果
        return []

    def warmup(self):
        pass

    def _clear_memory(self, state):
        pass