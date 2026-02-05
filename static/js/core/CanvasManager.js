// --- START OF FILE CanvasManager.js ---

import { hexToRgba } from '../utils/colorUtils.js';

const MIN_DRAG_DISTANCE_FOR_ANNOTATION = 5;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_SENSITIVITY = 0.1;

export class CanvasManager {
    constructor(bus, imageManager, labelManager, annotators) {
        this.bus = bus;
        this.imageManager = imageManager;
        this.labelManager = labelManager;
        this.annotators = annotators;

        this.canvas = document.getElementById('annotationCanvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        if (!this.canvas) return;

        this.zoomLevel = 1;
        this.panOffset = { x: 0, y: 0 };
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };

        this.currentToolMode = 'annotate';
        this.selectedAnnotationInfo = null;
        this.lastCreatedAnnotation = null;
        this.hoveredAnnotationInfo = null;
        this.activeDragInfo = null;
        this.realTimeCrosshairPos = null;
        this.eventForCurrentPos = null;

        this.setupEventListeners();

        this.bus.on('imageLoaded', this.setupImageForDisplay.bind(this));
        this.bus.on('redraw', this.redrawCanvas.bind(this));
        this.bus.on('resizeCanvas', this.resizeCanvas.bind(this));

        setTimeout(() => this.resizeCanvas(), 50);
    }

    setupEventListeners() {
        window.addEventListener('resize', this.resizeCanvas.bind(this));
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.handleWheelZoom.bind(this), { passive: false });
        this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));

        document.addEventListener('mousedown', (e) => {
            const contextMenuDiv = document.getElementById('contextMenu');
            if (contextMenuDiv && !contextMenuDiv.contains(e.target)) {
                this.bus.emit('hideContextMenu');
            }
        }, true);
    }

    clearSelection() {
        this.selectedAnnotationInfo = null;
        this.activeDragInfo = null;
        this.hoveredAnnotationInfo = null;
        this.lastCreatedAnnotation = null;
    }

    resizeCanvas() {
        const imgData = this.imageManager.getCurrentImage();
        const canvasWrapper = document.querySelector('.canvas-wrapper');
        if (!canvasWrapper || !this.canvas) return;

        const newWidth = canvasWrapper.clientWidth;
        const newHeight = canvasWrapper.clientHeight;

        if (this.canvas.width === newWidth && this.canvas.height === newHeight) {
            if (imgData && imgData.hasLoadedData) this.redrawCanvas();
            return;
        }

        this.canvas.width = newWidth;
        this.canvas.height = newHeight;

        if (imgData && imgData.hasLoadedData) {
            this.setupImageForDisplay(imgData);
        } else if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = "#ddd";
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = "black";
            this.ctx.textAlign = "center";
            this.ctx.font = "16px Arial";
            this.ctx.fillText("任务中没有图片。", this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    setupImageForDisplay(imgData) {
        if (!this.canvas) return;
        this.clearSelection();
        this.realTimeCrosshairPos = null;

        const canvasAspect = this.canvas.width / this.canvas.height;
        const imgAspect = imgData.originalWidth / imgData.originalHeight;

        this.zoomLevel = (imgAspect > canvasAspect) ?
            (this.canvas.width / imgData.originalWidth) :
            (this.canvas.height / imgData.originalHeight);

        this.zoomLevel = Math.min(this.zoomLevel * 0.95, MAX_ZOOM);
        this.zoomLevel = Math.max(this.zoomLevel, MIN_ZOOM);

        this.panOffset.x = (this.canvas.width - imgData.originalWidth * this.zoomLevel) / 2;
        this.panOffset.y = (this.canvas.height - imgData.originalHeight * this.zoomLevel) / 2;

        this.redrawCanvas();
    }

    redrawCanvas() {
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData || !this.ctx) return;

        const { ctx, canvas, zoomLevel, panOffset } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e9ecef';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(panOffset.x, panOffset.y);
        ctx.scale(zoomLevel, zoomLevel);

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(imgData.loadedImg, 0, 0, imgData.originalWidth, imgData.originalHeight);

        if (this.annotators['rect']) {
             this.annotators['rect'].drawAnnotations(imgData.annotations || [], this.selectedAnnotationInfo, this.hoveredAnnotationInfo, zoomLevel, ctx, this.currentToolMode);
        }
        if (this.annotators['polygon']) {
             this.annotators['polygon'].drawAnnotations(imgData.annotations || [], this.selectedAnnotationInfo, this.hoveredAnnotationInfo, zoomLevel, ctx, this.currentToolMode);
        }
        if (this.annotators['obb']) {
             this.annotators['obb'].drawAnnotations(imgData.annotations || [], this.selectedAnnotationInfo, this.hoveredAnnotationInfo, zoomLevel, ctx, this.currentToolMode);
        }

        const currentAnnotator = this.annotators[this.currentToolMode];
        if (currentAnnotator && (currentAnnotator.isDrawing || (this.currentToolMode === 'sam_assist' && currentAnnotator.prompts?.length > 0))) {
            currentAnnotator.drawPreview(
                this.labelManager.getCurrentLabel(),
                imgData.originalWidth,
                imgData.originalHeight,
                zoomLevel,
                ctx
            );
        }

        if (this.realTimeCrosshairPos && imgData) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.lineWidth = 1 / zoomLevel;
            ctx.beginPath();
            ctx.moveTo(0, this.realTimeCrosshairPos.y);
            ctx.lineTo(imgData.originalWidth, this.realTimeCrosshairPos.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(this.realTimeCrosshairPos.x, 0);
            ctx.lineTo(this.realTimeCrosshairPos.x, imgData.originalHeight);
            ctx.stroke();
        }

        ctx.restore();
    }

    getMousePosOnImage(event) {
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData || !this.canvas) return null;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const imgX = (x - this.panOffset.x) / this.zoomLevel;
        const imgY = (y - this.panOffset.y) / this.zoomLevel;
        return { x: imgX, y: imgY };
    }

    handleMouseDown(e) {
        this.eventForCurrentPos = e;
        this.bus.emit('hideContextMenu');
        this.hoveredAnnotationInfo = null;

        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData) return;

        const posOnImage = this.getMousePosOnImage(e);
        if (!posOnImage) return;

        if (e.button === 2) {
            const currentAnnotator = this.annotators[this.currentToolMode];
            if (this.currentToolMode === 'annotate' && currentAnnotator.isContinuousDrawing && currentAnnotator.isDrawing) return;
            if (this.currentToolMode === 'selectEdit' && this.getAnnotationAtPoint(posOnImage).annotation) return;
            if (this.currentToolMode === 'sam_assist') {
                const samAnnotator = this.annotators['sam_assist'];
                const hit = samAnnotator.getHitType(posOnImage, this.zoomLevel);
                if (hit) { samAnnotator.deletePrompt(hit.index); return; }
            }
            this.isPanning = true;
            this.panStart.x = e.clientX - this.panOffset.x;
            this.panStart.y = e.clientY - this.panOffset.y;
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.button !== 0) return;

        const currentAnnotator = this.annotators[this.currentToolMode];

        if (this.currentToolMode === 'annotate') {
            if (!this.labelManager.getCurrentLabel()) {
                this.bus.emit('statusMessage', "请先选择或创建一个标签！", "error");
                return;
            }
            this.selectedAnnotationInfo = null;
            this.activeDragInfo = null;
            currentAnnotator.startDrawing(posOnImage, this.labelManager.getCurrentLabel());

        } else if (this.currentToolMode === 'sam_assist') {
            const samAnnotator = this.annotators['sam_assist'];
            const hit = samAnnotator.getHitType(posOnImage, this.zoomLevel);
            if (hit) {
                samAnnotator.selectedPromptIndex = hit.index;
                this.activeDragInfo = {
                    type: hit.type,
                    initialMousePosOnImage: posOnImage,
                    originalData: JSON.parse(JSON.stringify(samAnnotator.prompts[hit.index].data)),
                    promptIndex: hit.index
                };
            } else {
                if (!this.labelManager.getCurrentLabel()) {
                    this.bus.emit('statusMessage', "请先选择或创建一个标签！", "error");
                    return;
                }
                currentAnnotator.startDrawing(posOnImage, this.labelManager.getCurrentLabel());
            }

        } else if (this.currentToolMode === 'selectEdit') {
            this.activeDragInfo = null;
            const hitInfo = this.getAnnotationAtPoint(posOnImage);
            if (hitInfo.annotation) {
                this.selectedAnnotationInfo = {
                    annotation: hitInfo.annotation,
                    index: hitInfo.index,
                    imageName: imgData.name
                };
                this.lastCreatedAnnotation = hitInfo.annotation;
                this.activeDragInfo = {
                    type: hitInfo.hitType,
                    initialMousePosOnImage: posOnImage,
                    originalPoints: JSON.parse(JSON.stringify(hitInfo.annotation.points)),
                    annotationRef: hitInfo.annotation
                };
                this.bus.stateManager.pushToUndoStack();
            } else {
                this.selectedAnnotationInfo = null;
                this.lastCreatedAnnotation = null;
            }
        }
        this.redrawCanvas();
    }

    handleMouseMove(e) {
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData) return;

        this.eventForCurrentPos = e;
        const posOnImage = this.getMousePosOnImage(e);
        this.realTimeCrosshairPos = posOnImage;

        let newCursor = 'default';

        if (this.isPanning) {
            newCursor = 'grabbing';
            this.panOffset.x = e.clientX - this.panStart.x;
            this.panOffset.y = e.clientY - this.panStart.y;
        } else if (this.currentToolMode === 'annotate') {
            const currentAnnotator = this.annotators[this.currentToolMode];
            newCursor = 'crosshair';
            if (currentAnnotator.isDrawing) {
                currentAnnotator.updateDrawing(posOnImage);
            }
        } else if (this.currentToolMode === 'sam_assist') {
            const samAnnotator = this.annotators['sam_assist'];
            if (this.activeDragInfo) {
                newCursor = 'grabbing';
                samAnnotator.updateDrag(this.activeDragInfo, posOnImage, imgData);
            } else if (samAnnotator.isDrawing) {
                newCursor = 'crosshair';
                samAnnotator.updateDrawing(posOnImage);
            } else {
                const hit = samAnnotator.getHitType(posOnImage, this.zoomLevel);
                if (hit) {
                    const action = hit.type.split('-').slice(2).join('-');
                    newCursor = this.getCursorForHitType(action);
                } else {
                    newCursor = 'crosshair';
                }
            }

        } else if (this.activeDragInfo && posOnImage) {
            newCursor = 'grabbing';
            const annType = this.activeDragInfo.annotationRef.type;
            const dragAnnotator = this.annotators[annType] || this.annotators['rect'];
            dragAnnotator.updateDrag(this.activeDragInfo, posOnImage, imgData);
        } else if (this.currentToolMode === 'selectEdit' && posOnImage) {
            const hitInfo = this.getAnnotationAtPoint(posOnImage);
            this.hoveredAnnotationInfo = hitInfo.annotation ? hitInfo : null;
            if (this.hoveredAnnotationInfo && this.hoveredAnnotationInfo.hitType) {
                newCursor = this.getCursorForHitType(this.hoveredAnnotationInfo.hitType);
            } else {
                newCursor = 'default';
            }
        }

        this.canvas.style.cursor = newCursor;
        this.redrawCanvas();
    }

    handleMouseUp(e) {
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData) return;
        if (this.isPanning) { this.isPanning = false; this.canvas.style.cursor = 'default'; return; }
        if (e.button !== 0) return;

        const posOnImage = this.getMousePosOnImage(e);
        const currentAnnotator = this.annotators[this.currentToolMode];

        if ((this.currentToolMode === 'annotate' || this.currentToolMode === 'sam_assist')) {
            if (this.currentToolMode === 'sam_assist' && this.activeDragInfo) {
                this.activeDragInfo = null;
            }
            else if (currentAnnotator.isDrawing) {
                if (currentAnnotator.isContinuousDrawing) {
                    // 【关键修改】通用化调用：只要支持 handleMouseUpInDrawing，就调用它
                    if (currentAnnotator.handleMouseUpInDrawing) {
                        currentAnnotator.handleMouseUpInDrawing(posOnImage);
                    }
                } else {
                    const resultAnn = currentAnnotator.endDrawing(posOnImage, imgData.originalWidth, imgData.originalHeight, MIN_DRAG_DISTANCE_FOR_ANNOTATION);
                    if (resultAnn) {
                        this.bus.stateManager.pushToUndoStack();
                        imgData.annotations.push(resultAnn);
                        const newIndex = imgData.annotations.length - 1;
                        this.selectedAnnotationInfo = { annotation: resultAnn, index: newIndex, imageName: imgData.name };
                        this.lastCreatedAnnotation = resultAnn;
                        this.bus.emit('statusMessage', "标注完成。", "success", 2000);
                    }
                }
            }
        } else if (this.currentToolMode === 'selectEdit' && this.activeDragInfo) {
            this.activeDragInfo = null;
        }
        this.redrawCanvas();
    }

    handleMouseLeave() {
        this.realTimeCrosshairPos = null;
        this.hoveredAnnotationInfo = null;
        this.canvas.style.cursor = (this.currentToolMode === 'annotate' || this.currentToolMode === 'sam_assist') ? 'crosshair' : 'default';
        this.redrawCanvas();
    }

    handleWheelZoom(e) {
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData || !this.canvas) return;
        e.preventDefault();

        if (this.currentToolMode === 'selectEdit') {
            if (this.hoveredAnnotationInfo && this.hoveredAnnotationInfo.hitType === 'rotate-center') {
                const ann = this.hoveredAnnotationInfo.annotation;
                const handler = this.annotators['obb'];
                if (handler && handler.rotateByWheel) {
                    handler.rotateByWheel(ann, e.deltaY);
                    this.bus.stateManager.pushToUndoStack();
                    this.redrawCanvas();
                    return;
                }
            }
        }

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const mouseWorldX = (mouseX - this.panOffset.x) / this.zoomLevel;
        const mouseWorldY = (mouseY - this.panOffset.y) / this.zoomLevel;
        const delta = e.deltaY > 0 ? -ZOOM_SENSITIVITY : ZOOM_SENSITIVITY;
        let newZoomLevel = this.zoomLevel * (1 + delta);
        newZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoomLevel));
        this.panOffset.x = mouseX - mouseWorldX * newZoomLevel;
        this.panOffset.y = mouseY - mouseWorldY * newZoomLevel;
        this.zoomLevel = newZoomLevel;
        this.redrawCanvas();
    }

    handleContextMenu(e) {
        const currentAnnotator = this.annotators[this.currentToolMode];
        if (this.currentToolMode === 'annotate' && currentAnnotator.isContinuousDrawing && currentAnnotator.isDrawing) {
            e.preventDefault();
            if (currentAnnotator.cancelDrawing) {
                currentAnnotator.cancelDrawing();
            }
            return;
        }

        e.preventDefault();
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData || !imgData.hasLoadedData) return;

        const posOnImage = this.getMousePosOnImage(e);
        if (!posOnImage) return;

        const clickedAnnInfo = this.getAnnotationAtPoint(posOnImage);
        if (clickedAnnInfo.annotation) {
            this.selectedAnnotationInfo = clickedAnnInfo;
            this.lastCreatedAnnotation = clickedAnnInfo.annotation;
            this.bus.emit('annotationsSelected', {
                annotation: clickedAnnInfo.annotation,
                index: clickedAnnInfo.index,
                event: e
            });
            this.redrawCanvas();
        } else {
            if (this.currentToolMode === 'selectEdit') this.selectedAnnotationInfo = null;
            this.bus.emit('hideContextMenu');
            this.redrawCanvas();
        }
    }

    getAnnotationAtPoint(imgPos) {
        const imgData = this.imageManager.getCurrentImage();
        if (!imgData) return { annotation: null, index: -1, hitType: null };
        const currentImageAnnotations = imgData.annotations || [];

        if (this.selectedAnnotationInfo && this.selectedAnnotationInfo.annotation) {
            const ann = this.selectedAnnotationInfo.annotation;
            const handler = this.annotators[ann.type] || this.annotators['rect'];
            const hitHandle = handler.getHitType(ann, imgPos, this.zoomLevel, true);
            if (hitHandle) {
                return {
                    annotation: ann,
                    index: this.selectedAnnotationInfo.index,
                    hitType: hitHandle
                };
            }
        }

        const indexedAnnotations = currentImageAnnotations.map((ann, idx) => ({ ann, originalIndex: idx }))
            .sort((a, b) => {
                const areaA = this._getArea(a.ann);
                const areaB = this._getArea(b.ann);
                return areaA - areaB;
            });

        for (const item of indexedAnnotations) {
            const handler = this.annotators[item.ann.type] || this.annotators['rect'];
            if (handler) {
                const hitType = handler.getHitType(item.ann, imgPos, this.zoomLevel);
                if (hitType) {
                    return { annotation: item.ann, index: item.originalIndex, hitType: hitType };
                }
            }
        }

        return { annotation: null, index: -1, hitType: null };
    }

    _getArea(ann) {
        if (ann.type === 'rect') {
            return ann.points.w * ann.points.h;
        } else if (ann.type === 'obb') {
            return ann.points.w * ann.points.h;
        } else if (ann.type === 'polygon') {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            ann.points.forEach(p => {
                minX = Math.min(minX, p[0]);
                maxX = Math.max(maxX, p[0]);
                minY = Math.min(minY, p[1]);
                maxY = Math.max(maxY, p[1]);
            });
            return (maxX - minX) * (maxY - minY);
        }
        return 999999;
    }

    getCursorForHitType(hitType) {
        if (!hitType) return 'default';
        if (hitType === 'move') return 'move';
        if (['resize-tl', 'resize-br'].includes(hitType)) return 'nwse-resize';
        if (['resize-tr', 'resize-bl'].includes(hitType)) return 'nesw-resize';
        if (['resize-t', 'resize-b'].includes(hitType)) return 'ns-resize';
        if (['resize-l', 'resize-r'].includes(hitType)) return 'ew-resize';
        if (hitType.startsWith('vertex-')) return 'pointer';
        if (hitType === 'rotate-center') return 'alias';
        return 'default';
    }

    setToolMode(mode) {
        this.currentToolMode = mode;
        this.canvas.style.cursor = (mode === 'annotate' || mode === 'sam_assist') ? 'crosshair' : 'default';
        this.selectedAnnotationInfo = null;
        this.activeDragInfo = null;
        this.bus.emit('modeChanged', mode);
        this.redrawCanvas();
    }

    getToolMode() { return this.currentToolMode; }
    getSelectedAnnotation() { return this.selectedAnnotationInfo; }

    moveSelectedAnnotation(dx, dy) {
        if (!this.selectedAnnotationInfo) return;
        const ann = this.selectedAnnotationInfo.annotation;
        const imgData = this.imageManager.getCurrentImage();
        this.bus.stateManager.pushToUndoStack();

        const fakeDragInfo = {
            type: 'move',
            initialMousePosOnImage: { x: 0, y: 0 },
            originalPoints: JSON.parse(JSON.stringify(ann.points)),
            annotationRef: ann
        };
        const targetPos = { x: dx, y: dy };
        const handler = this.annotators[ann.type] || this.annotators['rect'];
        handler.updateDrag(fakeDragInfo, targetPos, imgData);
        this.redrawCanvas();
    }
}