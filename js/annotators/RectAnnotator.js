// --- START OF FILE RectAnnotator.js ---

import { BaseAnnotator } from './BaseAnnotator.js';
import { clampRectangleToImage, getHandleRects, isPointInRect } from '../utils/geometryUtils.js';
import { hexToRgba } from '../utils/colorUtils.js';

const HANDLE_SIZE_SCREEN = 20;

export class RectAnnotator extends BaseAnnotator {
    constructor(bus) {
        super(bus);
        this.drawingMode = 'rect';
        this.currentLabel = null;
        this.isContinuousDrawing = false;
    }

    startDrawing(posOnImage, currentLabel) {
        this.isDrawing = true;
        this.startPoint = posOnImage;
        this.currentLabel = currentLabel;
    }

    updateDrawing(posOnImage) {
    }

    endDrawing(endPoint, imgWidth, imgHeight, minDragDistance) {
        this.isDrawing = false;

        if (!this.startPoint || !this.currentLabel || !endPoint) {
            this.startPoint = null;
            return null;
        }

        const x1 = Math.min(this.startPoint.x, endPoint.x);
        const y1 = Math.min(this.startPoint.y, endPoint.y);
        const w = Math.abs(endPoint.x - this.startPoint.x);
        const h = Math.abs(endPoint.y - this.startPoint.y);

        this.startPoint = null;

        if (w < minDragDistance && h < minDragDistance) {
            return null;
        }

        const clampedPoints = clampRectangleToImage(x1, y1, w, h, imgWidth, imgHeight);

        if (clampedPoints.w <= 0 || clampedPoints.h <= 0) {
            return null;
        }

        return {
            type: 'rect',
            label: this.currentLabel.name,
            points: clampedPoints,
            color: this.currentLabel.color
        };
    }

    drawPreview(currentLabel, imgWidth, imgHeight, zoomLevel, ctx) {
        if (!this.isDrawing || !this.startPoint || !this.bus.canvasManager.eventForCurrentPos) return;

        const currentPos = this.bus.canvasManager.getMousePosOnImage(this.bus.canvasManager.eventForCurrentPos);
        if (!currentPos || !currentLabel) return;

        const x1 = Math.min(this.startPoint.x, currentPos.x);
        const y1 = Math.min(this.startPoint.y, currentPos.y);
        const w = Math.abs(currentPos.x - this.startPoint.x);
        const h = Math.abs(currentPos.y - this.startPoint.y);

        const previewPoints = clampRectangleToImage(x1, y1, w, h, imgWidth, imgHeight);

        ctx.strokeStyle = currentLabel.color;
        ctx.lineWidth = 2 / zoomLevel;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.rect(previewPoints.x, previewPoints.y, previewPoints.w, previewPoints.h);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    drawAnnotations(annotations, selectedInfo, hoveredInfo, zoomLevel, ctx, currentToolMode) {
        const isDragging = this.bus.canvasManager.activeDragInfo;

        const sortedAnnotations = annotations
            .map((ann, index) => ({ ann, originalIndex: index }))
            .sort((a, b) => {
                 if(a.ann.type !== 'rect' || b.ann.type !== 'rect') return 0;
                 return (a.ann.points.w * a.ann.points.h) - (b.ann.points.w * b.ann.points.h)
            });

        sortedAnnotations.forEach(item => {
            const ann = item.ann;
            if (ann.type !== 'rect') return;

            const isSelected = selectedInfo && selectedInfo.annotation === ann;
            const isBeingActivelyDragged = isDragging && isDragging.annotationRef === ann;

            ctx.strokeStyle = ann.color;
            ctx.fillStyle = hexToRgba(ann.color, 0.3);
            ctx.lineWidth = (isSelected || isBeingActivelyDragged) ? (3 / zoomLevel) : (1.5 / zoomLevel);

            const p = ann.points;
            ctx.beginPath();
            ctx.rect(p.x, p.y, p.w, p.h);
            ctx.stroke();
            ctx.fill();

            // 【优化】标签样式：白边黑字，大字体
            ctx.font = `bold ${Math.max(12, 14/zoomLevel)}px Arial`;
            ctx.textAlign = 'left';

            // Halo
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3 / zoomLevel;
            ctx.strokeText(ann.label, p.x, p.y - 5/zoomLevel);

            // Text
            ctx.fillStyle = 'black';
            ctx.fillText(ann.label, p.x, p.y - 5/zoomLevel);

            if (currentToolMode === 'selectEdit' && (isSelected || hoveredInfo?.annotation === ann || isBeingActivelyDragged)) {
                const effectiveHandleSize = HANDLE_SIZE_SCREEN / zoomLevel;
                const handles = getHandleRects(p, effectiveHandleSize);

                handles.forEach(handle => {
                    const isHoveredHandle = (hoveredInfo &&
                                            hoveredInfo.annotation === ann &&
                                            hoveredInfo.hitType === handle.type);
                    ctx.fillStyle = isBeingActivelyDragged ? hexToRgba(ann.color, 0.95) :
                                    (isHoveredHandle ? hexToRgba(ann.color, 0.9) : hexToRgba(ann.color, 0.7));
                    ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
                });
            }
        });
    }

    getHitType(ann, posOnImage, zoomLevel, checkOnlyHandles = false) {
        if (ann.type !== 'rect') return null;
        const p = ann.points;
        const effectiveHandleSize = HANDLE_SIZE_SCREEN / zoomLevel;

        const handles = getHandleRects(p, effectiveHandleSize);
        for (const handle of handles) {
            if (isPointInRect(posOnImage, handle)) {
                return handle.type;
            }
        }

        if (!checkOnlyHandles) {
            if (isPointInRect(posOnImage, p)) {
                return 'move';
            }
        }
        return null;
    }

    updateDrag(activeDragInfo, posOnImage, imgData) {
        const op = activeDragInfo.originalPoints;
        const cp = activeDragInfo.annotationRef.points;
        const imgWidth = imgData.originalWidth;
        const imgHeight = imgData.originalHeight;

        let newX = op.x, newY = op.y, newW = op.w, newH = op.h;
        const mouseDx = posOnImage.x - activeDragInfo.initialMousePosOnImage.x;
        const mouseDy = posOnImage.y - activeDragInfo.initialMousePosOnImage.y;

        switch (activeDragInfo.type) {
            case 'move':
                newX = op.x + mouseDx;
                newY = op.y + mouseDy;
                newX = Math.max(0, Math.min(newX, imgWidth - op.w));
                newY = Math.max(0, Math.min(newY, imgHeight - op.h));
                break;
            case 'resize-tl': newX = op.x + mouseDx; newY = op.y + mouseDy; newW = op.w - mouseDx; newH = op.h - mouseDy; break;
            case 'resize-tr': newY = op.y + mouseDy; newW = op.w + mouseDx; newH = op.h - mouseDy; break;
            case 'resize-br': newW = op.w + mouseDx; newH = op.h + mouseDy; break;
            case 'resize-bl': newX = op.x + mouseDx; newW = op.w - mouseDx; newH = op.h + mouseDy; break;
            case 'resize-t': newY = op.y + mouseDy; newH = op.h - mouseDy; break;
            case 'resize-r': newW = op.w + mouseDx; break;
            case 'resize-b': newH = op.h + mouseDy; break;
            case 'resize-l': newX = op.x + mouseDx; newW = op.w - mouseDx; break;
        }

        const clampedPoints = clampRectangleToImage(newX, newY, newW, newH, imgWidth, imgHeight);

        cp.x = clampedPoints.x;
        cp.y = clampedPoints.y;
        cp.w = clampedPoints.w;
        cp.h = clampedPoints.h;
    }
}