// static/js/pages/annotate_Rect.js

import { EventBus } from '../core/EventBus.js';
import { APIClient } from '../utils/apiClient.js';
import { UIManager } from '../core/UIManager.js';
import { LabelManager } from '../core/LabelManager.js';
import { ImageManager } from '../core/ImageManager.js';
import { CanvasManager } from '../core/CanvasManager.js';
import { StateManager } from '../core/StateManager.js';
import { KeyboardController } from '../core/KeyboardController.js';

import { RectAnnotator } from '../annotators/RectAnnotator.js';
import { SAMAnnotator } from '../annotators/SAMAnnotator.js';

document.addEventListener('DOMContentLoaded', () => {
    const owner = document.getElementById('owner').value;
    const taskName = document.getElementById('taskName').value;

    if (!owner || !taskName) return;

    const bus = new EventBus();
    const apiClient = new APIClient(owner, taskName);
    const imageManager = new ImageManager(bus, apiClient);
    bus.imageManager = imageManager;
    const labelManager = new LabelManager(bus, imageManager);
    bus.labelManager = labelManager;
    const uiManager = new UIManager(bus, imageManager, labelManager, {});
    const stateManager = new StateManager(bus, imageManager);
    bus.stateManager = stateManager;

    const rectAnnotator = new RectAnnotator(bus);
    const samAnnotator = new SAMAnnotator(bus);

    samAnnotator.requireOrientation = false;

    const annotators = {
        'rect': rectAnnotator,
        'annotate': rectAnnotator,
        'selectEdit': rectAnnotator,
        'sam_assist': samAnnotator
    };

    const canvasManager = new CanvasManager(bus, imageManager, labelManager, annotators);
    bus.canvasManager = canvasManager;

    const keyboardController = new KeyboardController(bus, canvasManager, labelManager, imageManager, stateManager);

    bus.on('submitSAMRequest', async () => {
        const prompts = samAnnotator.prompts;
        if (prompts.length === 0) {
            uiManager.showStatusMessage("没有辅助提示，请先画框或点。", "info");
            return;
        }

        const imgData = imageManager.getCurrentImage();
        if (!imgData) return;

        const slider = document.getElementById('interactiveConfSlider');
        const conf = slider ? parseFloat(slider.value) : 0.6;

        // 【新增】获取当前 SAM 模式 (semantic / standard)
        const samMode = samAnnotator.samMode;

        uiManager.showLoading(true, "AI 正在思考中...");
        try {
            // 【新增】传入 samMode
            const result = await apiClient.runSAMInference(imgData.name, prompts, conf, samMode);

            if (result.success && result.annotations) {
                stateManager.pushToUndoStack();

                result.annotations.forEach(polyAnn => {
                    if (polyAnn.type === 'polygon') {
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        polyAnn.points.forEach(p => {
                            if (p[0] < minX) minX = p[0];
                            if (p[0] > maxX) maxX = p[0];
                            if (p[1] < minY) minY = p[1];
                            if (p[1] > maxY) maxY = p[1];
                        });

                        if (minX < maxX && minY < maxY) {
                            imgData.annotations.push({
                                type: 'rect',
                                label: polyAnn.label,
                                color: polyAnn.color,
                                points: {
                                    x: minX,
                                    y: minY,
                                    w: maxX - minX,
                                    h: maxY - minY
                                }
                            });
                        }
                    }
                });

                samAnnotator.clearPrompts();
                uiManager.showStatusMessage(`AI 生成了 ${result.annotations.length} 个矩形标注！`, "success");
                bus.emit('redraw');
            }
        } catch (err) {
            uiManager.showStatusMessage(`AI 推理失败: ${err.message}`, "error", 5000);
        } finally {
            uiManager.showLoading(false);
        }
    });

    bus.on('labelsInitialized', (labels) => labelManager.initialize(labels));
    bus.on('navigate', (direction) => imageManager.changeImage(direction));
    bus.on('deleteImage', (imageNames) => imageManager.deleteImages(imageNames));
    bus.on('handleDeleteCurrentImage', async () => await uiManager.handleDeleteCurrentImage());
    bus.on('deleteAnnotation', (index) => {
        const imgData = imageManager.getCurrentImage();
        if (imgData && imgData.annotations && imgData.annotations[index] && index >= 0) {
            stateManager.pushToUndoStack();
            canvasManager.clearSelection();
            imgData.annotations.splice(index, 1);
            bus.emit('redraw');
            uiManager.showStatusMessage("标注已删除。", "success");
        }
    });
    bus.on('updateAnnotationLabel', (data) => {
        const imgData = imageManager.getCurrentImage();
        const newLabelObj = labelManager.getLabels().find(l => l.name === data.newLabelName);
        if (imgData && newLabelObj && imgData.annotations && imgData.annotations[data.index]) {
            stateManager.pushToUndoStack();
            imgData.annotations[data.index].label = newLabelObj.name;
            imgData.annotations[data.index].color = newLabelObj.color;
            bus.emit('redraw');
            uiManager.showStatusMessage(`标注标签已更改为 "${newLabelObj.name}"`, "success");
            labelManager.selectLabel(newLabelObj);
        }
    });
    bus.on('finishAndTrain', async () => {
        try {
            await imageManager.saveCurrentImageAnnotations();
            const url = `/train/${encodeURIComponent(owner)}/${encodeURIComponent(taskName)}`;
            window.location.href = url;
        } catch (error) {
             uiManager.showStatusMessage(`保存失败: ${error.message}`, "error", 8000);
        }
    });

    imageManager.loadTaskData();
});