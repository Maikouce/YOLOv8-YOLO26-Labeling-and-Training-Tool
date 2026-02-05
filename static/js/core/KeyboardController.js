// static/js/core/KeyboardController.js
const MOVE_STEP_SCREEN = 5;
export class KeyboardController {
    constructor(bus, canvasManager, labelManager, imageManager, stateManager) {
        this.bus = bus;
        this.canvasManager = canvasManager;
        this.labelManager = labelManager;
        this.imageManager = imageManager;
        this.stateManager = stateManager;
        this.clipboard = null; // 用于存储复制的标注数据

        document.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    handleKeyDown(e) {
        if (!this.canvasManager) return;

        const batchManagementModal = document.getElementById('batchManagementModal');
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || batchManagementModal?.style.display === 'block') return;

        const keyNum = parseInt(e.key);
        const currentMode = this.canvasManager.getToolMode();
        const selectedAnnInfo = this.canvasManager.getSelectedAnnotation();
        const labels = this.labelManager.getLabels();

        // ----------------------------------------------------------------
        // 复制 (Ctrl+C)
        // ----------------------------------------------------------------
        if ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'C') {
            if (selectedAnnInfo && selectedAnnInfo.annotation) {
                // 仅允许复制矩形
                if (selectedAnnInfo.annotation.type === 'rect') {
                    e.preventDefault();
                    // 深拷贝标注数据
                    this.clipboard = JSON.parse(JSON.stringify(selectedAnnInfo.annotation));
                    this.bus.emit('statusMessage', "已复制标注框", "success", 1000);
                }
            }
            return;
        }

        // ----------------------------------------------------------------
        // 粘贴 (Ctrl+V)
        // ----------------------------------------------------------------
        if ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'V') {
            if (this.clipboard && this.clipboard.type === 'rect') {
                e.preventDefault();
                const imgData = this.imageManager.getCurrentImage();
                if (!imgData) return;

                // 获取鼠标在画布上的最后位置
                const lastEvent = this.canvasManager.eventForCurrentPos;
                if (!lastEvent) {
                    this.bus.emit('statusMessage', "请将鼠标移动到画布区域内进行粘贴", "warning");
                    return;
                }

                // 将屏幕坐标转换为图像坐标
                const mousePos = this.canvasManager.getMousePosOnImage(lastEvent);
                if (!mousePos) return;

                this.stateManager.pushToUndoStack();

                // 创建新对象
                const newAnn = JSON.parse(JSON.stringify(this.clipboard));
                const w = newAnn.points.w;
                const h = newAnn.points.h;

                // 计算中心点位置：让框的中心对准鼠标位置
                let newX = mousePos.x - (w / 2);
                let newY = mousePos.y - (h / 2);

                // 简单的边界检查，防止完全粘贴到图片外
                newX = Math.max(0, Math.min(newX, imgData.originalWidth - w));
                newY = Math.max(0, Math.min(newY, imgData.originalHeight - h));

                newAnn.points.x = newX;
                newAnn.points.y = newY;

                // 添加到当前图片
                imgData.annotations.push(newAnn);

                // 选中新粘贴的标注
                const newIndex = imgData.annotations.length - 1;
                this.canvasManager.selectedAnnotationInfo = {
                    annotation: newAnn,
                    index: newIndex,
                    imageName: imgData.name
                };
                this.canvasManager.lastCreatedAnnotation = newAnn;

                this.bus.emit('redraw');
                this.bus.emit('statusMessage', "已粘贴", "success", 1000);
            }
            return;
        }

        // 1. 切换模式 (~ 键)
        if (e.key === '`' || e.key === '~') {
            e.preventDefault();
            if (currentMode === 'sam_assist') {
                this.canvasManager.setToolMode('annotate');
                this.bus.emit('statusMessage', "退出辅助标注模式", "info");
            } else {
                this.canvasManager.setToolMode('sam_assist');
                this.bus.emit('statusMessage', "进入辅助标注模式：画框或点，按空格生成。", "success");
            }
            return;
        }

        // 2. 提交预测 (空格键)
        if (e.code === 'Space' && currentMode === 'sam_assist') {
            e.preventDefault();
            this.bus.emit('submitSAMRequest');
            return;
        }

        // 3. TAB 键 (Label Switching)
        if (e.key === 'Tab') {
            e.preventDefault();
            if (labels.length === 0) return;

            let currentIndex = labels.findIndex(l => l.name === this.labelManager.getCurrentLabel()?.name);
            let nextLabelIndex = e.shiftKey ?
                (currentIndex - 1 + labels.length) % labels.length :
                (currentIndex + 1) % labels.length;
            const newLabel = labels[nextLabelIndex];
            this.labelManager.selectLabel(newLabel);

            if (currentMode === 'sam_assist') {
                const samAnnotator = this.canvasManager.annotators['sam_assist'];
                if (samAnnotator) samAnnotator.changeLabelOfSelectedPrompt(newLabel);
            } else {
                const annToModify = selectedAnnInfo?.annotation || this.canvasManager.lastCreatedAnnotation;
                if (annToModify) {
                    if (annToModify.label !== newLabel.name) {
                        this.stateManager.pushToUndoStack();
                        annToModify.label = newLabel.name;
                        annToModify.color = newLabel.color;
                        this.bus.emit('redraw');
                    }
                }
            }
            return;
        }

        // 4. 数字键 1-9 (Quick Label)
        if (keyNum >= 1 && keyNum <= 9) {
            const labelIndex = keyNum - 1;
            if (labelIndex < labels.length) {
                const newLabel = labels[labelIndex];

                if (currentMode === 'sam_assist') {
                    this.labelManager.selectLabel(newLabel);
                    const samAnnotator = this.canvasManager.annotators['sam_assist'];
                    if (samAnnotator) samAnnotator.changeLabelOfSelectedPrompt(newLabel);
                } else if (selectedAnnInfo && selectedAnnInfo.annotation) {
                    if (selectedAnnInfo.annotation.label !== newLabel.name) {
                        this.bus.stateManager.pushToUndoStack();
                        selectedAnnInfo.annotation.label = newLabel.name;
                        selectedAnnInfo.annotation.color = newLabel.color;
                        this.labelManager.selectLabel(newLabel);
                        this.bus.emit('redraw');
                    }
                } else {
                    this.labelManager.selectLabel(newLabel);
                }
            } else {
                this.bus.emit('statusMessage', `标签 ${keyNum} 不存在。`, "info");
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toUpperCase() === 'D') {
            e.preventDefault();
            this.bus.emit('handleDeleteCurrentImage');
        } else if ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'Z') {
            e.preventDefault();
            this.stateManager.handleUndo();
        } else {
            let processed = true;
            switch (e.key.toUpperCase()) {
                // R 键切换 SAM 模式
                case 'R':
                    if (currentMode === 'sam_assist') {
                        const annotator = this.canvasManager.annotators['sam_assist'];
                        if (annotator) annotator.toggleMode();
                    }
                    break;

                // K 键清空当前图片所有标注
                case 'K':
                    const imgK = this.imageManager.getCurrentImage();
                    if (imgK && imgK.annotations && imgK.annotations.length > 0) {
                        if (confirm("确定要清空当前图片的所有标注吗？此操作可撤销。")) {
                            this.stateManager.pushToUndoStack();
                            imgK.annotations = [];
                            this.canvasManager.clearSelection();
                            this.bus.emit('redraw');
                            this.bus.emit('statusMessage', "所有标注已清空", "success");
                        }
                    } else {
                        this.bus.emit('statusMessage', "当前没有标注可清除", "info");
                    }
                    break;

                case 'A':
                    this.bus.emit('navigate', -1);
                    break;
                case 'D':
                    this.bus.emit('navigate', 1);
                    break;

                case 'W':
                    if (currentMode === 'sam_assist') {
                        this.canvasManager.setToolMode('annotate');
                        this.bus.emit('statusMessage', "已切换至普通标注模式", "info");
                    } else {
                        this.canvasManager.setToolMode('annotate');
                    }
                    break;
                case 'Q':
                    if (currentMode === 'sam_assist') {
                        this.canvasManager.setToolMode('selectEdit');
                        this.bus.emit('statusMessage', "已切换至编辑模式", "info");
                    } else {
                        this.canvasManager.setToolMode('selectEdit');
                    }
                    break;

                case 'DELETE':
                case 'E':
                    if (currentMode === 'sam_assist') {
                        const samAnnotator = this.canvasManager.annotators['sam_assist'];
                        if (samAnnotator && samAnnotator.selectedPromptIndex !== -1) {
                            samAnnotator.deletePrompt(samAnnotator.selectedPromptIndex);
                        }
                    } else if (selectedAnnInfo) {
                        this.bus.emit('deleteAnnotation', selectedAnnInfo.index);
                    } else processed = false;
                    break;
                case 'ESCAPE':
                    if (currentMode === 'sam_assist') {
                        const samAnnotator = this.canvasManager.annotators['sam_assist'];
                        if (samAnnotator.selectedPromptIndex !== -1) {
                            samAnnotator.selectedPromptIndex = -1;
                            this.bus.emit('redraw');
                        } else {
                            samAnnotator.clearPrompts();
                            this.bus.emit('statusMessage', "辅助提示已清空", "info");
                        }
                    } else {
                        const currentAnnotator = this.canvasManager.annotators[currentMode];
                        if (currentAnnotator.isDrawing) {
                            if (currentAnnotator.drawingMode === 'polygon') {
                                if (currentAnnotator.currentPoints.length > 0) this.stateManager.pushToUndoStack();
                                currentAnnotator.resetDrawingState ? currentAnnotator.resetDrawingState() : (currentAnnotator.isDrawing = false);
                            } else {
                                currentAnnotator.isDrawing = false;
                                currentAnnotator.startPoint = null;
                            }
                            this.bus.emit('redraw');
                        } else if (this.canvasManager.activeDragInfo) {
                            this.stateManager.handleUndo();
                            this.canvasManager.activeDragInfo = null;
                        } else if (selectedAnnInfo) {
                            this.canvasManager.clearSelection();
                            this.bus.emit('redraw');
                        }
                        this.bus.emit('hideContextMenu');
                    }
                    break;

                case 'ARROWLEFT':
                case 'ARROWUP':
                case 'ARROWRIGHT':
                case 'ARROWDOWN':
                    if (currentMode === 'selectEdit' && selectedAnnInfo) {
                        e.preventDefault();
                        const screenStep = (e.ctrlKey || e.metaKey) ? 20 : MOVE_STEP_SCREEN;
                        const step = screenStep / this.canvasManager.zoomLevel;
                        let dx = 0, dy = 0;
                        switch (e.key.toUpperCase()) {
                            case 'ARROWLEFT':
                                dx = -step;
                                break;
                            case 'ARROWRIGHT':
                                dx = step;
                                break;
                            case 'ARROWUP':
                                dy = -step;
                                break;
                            case 'ARROWDOWN':
                                dy = step;
                                break;
                        }
                        this.canvasManager.moveSelectedAnnotation(dx, dy);
                    } else processed = false;
                    break;
                default:
                    processed = false;
                    break;
            }
        }
    }
}