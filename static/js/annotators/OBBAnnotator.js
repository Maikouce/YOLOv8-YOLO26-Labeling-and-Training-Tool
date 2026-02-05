// --- START OF FILE OBBAnnotator.js ---

import { BaseAnnotator } from './BaseAnnotator.js';
import { hexToRgba } from '../utils/colorUtils.js';
import { rotatePoint, isPointInOBB, getOBBHandles, clampPointToImage, isPointInRect } from '../utils/geometryUtils.js';

const HANDLE_SIZE_SCREEN = 20;
const CENTER_HANDLE_RADIUS = 6;
const ARROW_LEN = 15;

export class OBBAnnotator extends BaseAnnotator {
    constructor(bus) {
        super(bus);
        this.drawingMode = 'obb';
        this.currentLabel = null;
        this.isContinuousDrawing = true;

        this.drawingStep = 0;
        this.p1 = null;
        this.p2 = null;
        this.p3 = null;
    }

    startDrawing(posOnImage, currentLabel) {
        const imgData = this.bus.imageManager.getCurrentImage();
        if (!imgData) return;

        const p = clampPointToImage(posOnImage, imgData.originalWidth, imgData.originalHeight);

        if (this.drawingStep === 0) {
            this.isDrawing = true;
            this.currentLabel = currentLabel;
            this.p1 = p;
            this.p2 = p;
            this.drawingStep = 1;
        } else if (this.drawingStep === 2) {
            this._finalizeOBB();
        }
    }

    // 【新增】取消绘制接口
    cancelDrawing() {
        this.isDrawing = false;
        this.drawingStep = 0;
        this.p1 = null;
        this.p2 = null;
        this.p3 = null;
        this.bus.emit('redraw');
        this.bus.emit('statusMessage', "已取消绘制。", "info");
    }

    updateDrawing(posOnImage) {
        if (!this.isDrawing) return;

        const p = posOnImage;

        if (this.drawingStep === 1) {
            this.p2 = p;
        } else if (this.drawingStep === 2) {
            this.p3 = p;
        }
    }

    handleMouseUpInDrawing(posOnImage) {
        if (this.drawingStep === 1) {
            const dx = this.p2.x - this.p1.x;
            const dy = this.p2.y - this.p1.y;
            const len = Math.sqrt(dx*dx + dy*dy);

            if (len < 5) return;

            this.drawingStep = 2;
            this.p3 = this.p2;
            this.bus.emit('statusMessage', "松开鼠标左键完成长边，移动鼠标调整宽度，再次点击完成。", "info", 3000);
        }
    }

    _finalizeOBB() {
        const obb = this._calculateOBBFromPoints(this.p1, this.p2, this.p3);

        if (obb.w < 2 || obb.h < 2) {
            this.bus.emit('statusMessage', "矩形太小，已丢弃。", "warning");
        } else {
            const finalAnn = {
                type: 'obb',
                label: this.currentLabel.name,
                color: this.currentLabel.color,
                points: obb
            };

            const imgData = this.bus.imageManager.getCurrentImage();
            this.bus.stateManager.pushToUndoStack();
            imgData.annotations.push(finalAnn);

            const newIndex = imgData.annotations.length - 1;
            this.bus.canvasManager.selectedAnnotationInfo = { annotation: finalAnn, index: newIndex, imageName: imgData.name };
            this.bus.emit('statusMessage', "OBB 标注完成。", "success");
        }

        this.isDrawing = false;
        this.drawingStep = 0;
        this.p1 = null;
        this.p2 = null;
        this.p3 = null;
        this.bus.emit('redraw');
    }

    _calculateOBBFromPoints(p1, p2, p3) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len1 = Math.sqrt(dx*dx + dy*dy);
        const angle = Math.atan2(dy, dx);

        const perpX = -dy / len1;
        const perpY = dx / len1;

        const v3x = p3.x - p1.x;
        const v3y = p3.y - p1.y;

        const width = v3x * perpX + v3y * perpY;

        const mid1x = (p1.x + p2.x) / 2;
        const mid1y = (p1.y + p2.y) / 2;

        const cx = mid1x + perpX * (width / 2);
        const cy = mid1y + perpY * (width / 2);

        return {
            x: cx,
            y: cy,
            w: len1,
            h: Math.abs(width),
            rotation: angle
        };
    }

    getHitType(ann, posOnImage, zoomLevel, checkOnlyHandles = false) {
        if (ann.type !== 'obb') return null;

        const centerDistSq = (posOnImage.x - ann.points.x)**2 + (posOnImage.y - ann.points.y)**2;
        const hitRadius = (CENTER_HANDLE_RADIUS * 1.5) / zoomLevel;
        if (centerDistSq < hitRadius * hitRadius) {
            return 'rotate-center';
        }

        const corners = getOBBHandles(ann.points, HANDLE_SIZE_SCREEN/zoomLevel);
        for (const h of corners) {
            if (isPointInRect(posOnImage, h)) {
                return h.type;
            }
        }

        if (checkOnlyHandles) return null;

        if (isPointInOBB(posOnImage, ann.points)) {
            return 'move';
        }

        return null;
    }

    rotateByWheel(ann, deltaY) {
        const step = (Math.PI / 180) * 5;
        if (deltaY > 0) {
            ann.points.rotation += step;
        } else {
            ann.points.rotation -= step;
        }
        if (ann.points.rotation > Math.PI) ann.points.rotation -= 2*Math.PI;
        if (ann.points.rotation < -Math.PI) ann.points.rotation += 2*Math.PI;
    }

    updateDrag(activeDragInfo, posOnImage, imgData) {
        const ann = activeDragInfo.annotationRef;
        const op = activeDragInfo.originalPoints;

        if (activeDragInfo.type === 'move') {
            const dx = posOnImage.x - activeDragInfo.initialMousePosOnImage.x;
            const dy = posOnImage.y - activeDragInfo.initialMousePosOnImage.y;
            ann.points.x = op.x + dx;
            ann.points.y = op.y + dy;
            return;
        }

        const currentCenter = { x: ann.points.x, y: ann.points.y };
        const rotation = ann.points.rotation;

        const halfW = op.w / 2;
        const halfH = op.h / 2;
        let left = -halfW, right = halfW, top = -halfH, bottom = halfH;

        const localMouse = rotatePoint(posOnImage, { x: op.x, y: op.y }, -rotation);
        const dx = localMouse.x - op.x;
        const dy = localMouse.y - op.y;

        switch (activeDragInfo.type) {
            case 'resize-l': left = dx; break;
            case 'resize-r': right = dx; break;
            case 'resize-t': top = dy; break;
            case 'resize-b': bottom = dy; break;
            case 'resize-tl': left = dx; top = dy; break;
            case 'resize-tr': right = dx; top = dy; break;
            case 'resize-bl': left = dx; bottom = dy; break;
            case 'resize-br': right = dx; bottom = dy; break;
        }

        if (left > right) [left, right] = [right, left];
        if (top > bottom) [top, bottom] = [bottom, top];

        const newW = right - left;
        const newH = bottom - top;
        const localCenterX = (left + right) / 2;
        const localCenterY = (top + bottom) / 2;

        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const globalCenterX = op.x + (localCenterX * cos - localCenterY * sin);
        const globalCenterY = op.y + (localCenterX * sin + localCenterY * cos);

        ann.points.w = Math.max(1, newW);
        ann.points.h = Math.max(1, newH);
        ann.points.x = globalCenterX;
        ann.points.y = globalCenterY;
    }

    drawPreview(currentLabel, imgWidth, imgHeight, zoomLevel, ctx) {
        if (!this.isDrawing) return;

        ctx.strokeStyle = currentLabel.color;
        ctx.lineWidth = 2 / zoomLevel;
        ctx.fillStyle = hexToRgba(currentLabel.color, 0.2);

        if (this.drawingStep === 1 && this.p1 && this.p2) {
            ctx.beginPath();
            ctx.moveTo(this.p1.x, this.p1.y);
            ctx.lineTo(this.p2.x, this.p2.y);
            ctx.stroke();
            this._drawArrow(ctx, this.p1, this.p2, zoomLevel);

            ctx.fillStyle = currentLabel.color;
            ctx.font = `${12/zoomLevel}px Arial`;
            ctx.fillText("Edge 1", (this.p1.x+this.p2.x)/2, (this.p1.y+this.p2.y)/2);

        } else if (this.drawingStep === 2 && this.p3) {
            const obb = this._calculateOBBFromPoints(this.p1, this.p2, this.p3);
            this._drawOBBShape(ctx, obb);
            this._drawCenterIndicator(ctx, obb, zoomLevel);
        }
    }

    drawAnnotations(annotations, selectedInfo, hoveredInfo, zoomLevel, ctx, currentToolMode) {
        annotations.forEach(ann => {
            if (ann.type !== 'obb') return;

            const isSelected = selectedInfo && selectedInfo.annotation === ann;
            const isHovered = hoveredInfo && hoveredInfo.annotation === ann;

            ctx.save();
            ctx.translate(ann.points.x, ann.points.y);
            ctx.rotate(ann.points.rotation);

            ctx.strokeStyle = ann.color;
            ctx.fillStyle = hexToRgba(ann.color, isSelected ? 0.4 : 0.2);
            ctx.lineWidth = (isSelected ? 3 : 1.5) / zoomLevel;

            ctx.beginPath();
            ctx.rect(-ann.points.w/2, -ann.points.h/2, ann.points.w, ann.points.h);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // Text Style Optimized
            ctx.font = `bold ${Math.max(12, 14/zoomLevel)}px Arial`;
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3 / zoomLevel;
            ctx.strokeText(ann.label, ann.points.x, ann.points.y - ann.points.h/2 - 8/zoomLevel);
            ctx.fillStyle = 'black';
            ctx.fillText(ann.label, ann.points.x, ann.points.y - ann.points.h/2 - 8/zoomLevel);

            if (currentToolMode === 'selectEdit' && (isSelected || isHovered)) {
                this._drawCenterIndicator(ctx, ann.points, zoomLevel, hoveredInfo?.hitType === 'rotate-center');

                const handles = getOBBHandles(ann.points, HANDLE_SIZE_SCREEN/zoomLevel);
                handles.forEach(h => {
                    const isHandleHovered = (hoveredInfo && hoveredInfo.hitType === h.type);
                    ctx.fillStyle = isHandleHovered ? '#FFFFFF' : hexToRgba(ann.color, 0.9);
                    ctx.fillRect(h.x, h.y, h.w, h.h);
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 1 / zoomLevel;
                    ctx.strokeRect(h.x, h.y, h.w, h.h);
                });
            }
        });
    }

    _drawOBBShape(ctx, obb) {
        ctx.save();
        ctx.translate(obb.x, obb.y);
        ctx.rotate(obb.rotation);
        ctx.beginPath();
        ctx.rect(-obb.w/2, -obb.h/2, obb.w, obb.h);
        ctx.stroke();
        ctx.fill();
        ctx.restore();
    }

    _drawArrow(ctx, p1, p2, zoomLevel) {
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const headLen = ARROW_LEN / zoomLevel;
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }

    _drawCenterIndicator(ctx, obb, zoomLevel, isHovered=false) {
        const r = CENTER_HANDLE_RADIUS / zoomLevel;
        const arrowLen = (obb.w / 2) * 0.8;

        ctx.save();
        ctx.translate(obb.x, obb.y);
        ctx.rotate(obb.rotation);

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI*2);
        ctx.fillStyle = isHovered ? '#FFF' : 'rgba(255, 255, 0, 0.8)';
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(arrowLen, 0);
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 2 / zoomLevel;
        ctx.stroke();

        ctx.beginPath();
        ctx.lineTo(arrowLen, 0);
        ctx.lineTo(arrowLen - r, -r/2);
        ctx.lineTo(arrowLen - r, r/2);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.fill();

        if (isHovered) {
            ctx.restore();
            const deg = (obb.rotation * 180 / Math.PI).toFixed(1) + "°";
            const tx = obb.x + 15/zoomLevel;
            const ty = obb.y;
            ctx.font = `bold ${Math.max(14, 16/zoomLevel)}px Arial`;
            ctx.textAlign = 'left';
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3 / zoomLevel;
            ctx.strokeText(deg, tx, ty);
            ctx.fillStyle = 'black';
            ctx.fillText(deg, tx, ty);
            return;
        }

        ctx.restore();
    }

    endDrawing() { return null; }
}