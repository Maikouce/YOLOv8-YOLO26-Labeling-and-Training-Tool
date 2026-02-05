// --- START OF FILE PolygonAnnotator.js ---

import { BaseAnnotator } from './BaseAnnotator.js';
import { hexToRgba } from '../utils/colorUtils.js';
import { isPointInRect, isPolygonSelfIntersecting, repairPolygonByMaskProjection, clampPointToImage, forceClockwise, calculatePolygonArea } from '../utils/geometryUtils.js';

const HANDLE_SIZE_SCREEN = 20;
const MIN_POLYGON_VERTICES = 3;
const MIN_POINT_DIST_SQ = 5 * 5;
const MIN_VALID_AREA = 5;

export class PolygonAnnotator extends BaseAnnotator {
    constructor(bus) {
        super(bus);
        this.drawingMode = 'polygon';
        this.currentLabel = null;
        this.currentPoints = [];
        this.lastMovePoint = null;
        this.isContinuousDrawing = true;

        this.bus.on('imageIndexChanged', () => {
            this.resetDrawingState();
        });
    }

    get _imageManager() {
        return this.bus.imageManager || (this.bus.canvasManager && this.bus.canvasManager.imageManager);
    }

    resetDrawingState() {
        this.isDrawing = false;
        this.currentPoints = [];
        this.lastMovePoint = null;
        this.currentLabel = null;
        this.bus.emit('redraw');
    }

    static fixPolygon(points, imgWidth, imgHeight) {
        if (!points || points.length < MIN_POLYGON_VERTICES) return null;

        let finalPoints = [...points];

        if (isPolygonSelfIntersecting(finalPoints)) {
            finalPoints = repairPolygonByMaskProjection(finalPoints, imgWidth, imgHeight);
        } else {
            finalPoints = forceClockwise(finalPoints);
        }

        const area = calculatePolygonArea(finalPoints);
        if (area < MIN_VALID_AREA) return null;

        return finalPoints;
    }

    startDrawing(posOnImage, currentLabel) {
        const imgData = this._imageManager ? this._imageManager.getCurrentImage() : null;
        if (!imgData) return;

        const clampedPos = clampPointToImage(posOnImage, imgData.originalWidth, imgData.originalHeight);

        if (this.isDrawing && this.currentPoints.length > 0) {
            const lastP = this.currentPoints[this.currentPoints.length - 1];
            const dx = clampedPos.x - lastP[0];
            const dy = clampedPos.y - lastP[1];
            if (dx * dx + dy * dy < MIN_POINT_DIST_SQ) {
                return;
            }
        }

        if (!this.isDrawing) {
            this.isDrawing = true;
            this.currentLabel = currentLabel;
            this.currentPoints = [];
            this.bus.emit('statusMessage', "多边形绘制中：左键添加点，右键闭合。", "info");
        }

        this.currentPoints.push([clampedPos.x, clampedPos.y]);
        this.bus.emit('redraw');
    }

    updateDrawing(posOnImage) {
        if (this.isDrawing) {
            const imgData = this._imageManager ? this._imageManager.getCurrentImage() : null;
            if (!imgData) return;
            this.lastMovePoint = clampPointToImage(posOnImage, imgData.originalWidth, imgData.originalHeight);
        }
    }

    closePolygon(imgWidth, imgHeight) {
        if (!this.isDrawing) return null;

        if (this.currentPoints.length < MIN_POLYGON_VERTICES) {
             this.bus.emit('statusMessage', `点数不足，多边形标注已取消。`, "info", 2000);
             this.resetDrawingState();
             return null;
        }

        const fixedPoints = PolygonAnnotator.fixPolygon(this.currentPoints, imgWidth, imgHeight);

        if (!fixedPoints) {
            this.bus.emit('statusMessage', "多边形无效（面积过小），已丢弃。", "error", 3000);
            this.resetDrawingState();
            return null;
        }

        const finalAnnotation = {
            type: 'polygon',
            label: this.currentLabel.name,
            points: fixedPoints,
            color: this.currentLabel.color
        };

        this.isDrawing = false;
        this.currentPoints = [];
        this.lastMovePoint = null;

        this.bus.emit('statusMessage', "多边形标注完成（已自动校验合法性）。", "success", 2000);

        return finalAnnotation;
    }

    endDrawing(endPoint, imgWidth, imgHeight, minDragDistance) {
        return null;
    }

    drawPreview(currentLabel, imgWidth, imgHeight, zoomLevel, ctx) {
        if (!this.isDrawing || this.currentPoints.length === 0) return;

        ctx.strokeStyle = currentLabel.color;
        ctx.fillStyle = hexToRgba(currentLabel.color, 0.4);
        ctx.lineWidth = 2 / zoomLevel;

        ctx.beginPath();
        ctx.moveTo(this.currentPoints[0][0], this.currentPoints[0][1]);
        for (let i = 1; i < this.currentPoints.length; i++) {
            ctx.lineTo(this.currentPoints[i][0], this.currentPoints[i][1]);
        }
        if (this.lastMovePoint) {
            ctx.lineTo(this.lastMovePoint.x, this.lastMovePoint.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        this._drawVertices(this.currentPoints, ctx, zoomLevel, currentLabel.color);
    }

    drawAnnotations(annotations, selectedInfo, hoveredInfo, zoomLevel, ctx, currentToolMode) {
        const isDragging = this.bus.canvasManager.activeDragInfo;

        annotations.forEach((ann) => {
            if (ann.type !== 'polygon') return;

            const isSelected = selectedInfo && selectedInfo.annotation === ann;
            const isBeingActivelyDragged = isDragging && isDragging.annotationRef === ann;

            ctx.strokeStyle = ann.color;
            ctx.fillStyle = hexToRgba(ann.color, 0.3);
            ctx.lineWidth = (isSelected || isBeingActivelyDragged) ? (3 / zoomLevel) : (1.5 / zoomLevel);

            this._drawPolygonPath(ann.points, ctx);
            ctx.stroke();
            ctx.fill();

            if (ann.points.length > 0) {
                 // 【优化】标签样式
                 ctx.font = `bold ${Math.max(12, 14/zoomLevel)}px Arial`;
                 ctx.textAlign = 'left';
                 ctx.strokeStyle = 'white';
                 ctx.lineWidth = 3 / zoomLevel;
                 ctx.strokeText(ann.label, ann.points[0][0], ann.points[0][1] - 5/zoomLevel);
                 ctx.fillStyle = 'black';
                 ctx.fillText(ann.label, ann.points[0][0], ann.points[0][1] - 5/zoomLevel);
            }

            if (currentToolMode === 'selectEdit') {
                if (isSelected || isBeingActivelyDragged || hoveredInfo?.annotation === ann) {
                    this._drawVertices(ann.points, ctx, zoomLevel, ann.color, isSelected ? hoveredInfo : null);
                }
            }
        });
    }

    _drawPolygonPath(points, ctx) {
        if (points.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i][0], points[i][1]);
        }
        ctx.closePath();
    }

    _drawVertices(points, ctx, zoomLevel, color, hoveredInfo = null) {
        const hs = HANDLE_SIZE_SCREEN / zoomLevel;
        const hs_half = hs / 2;

        points.forEach(([x, y], index) => {
            const isHovered = hoveredInfo && hoveredInfo.hitType === `vertex-${index}`;

            ctx.fillStyle = isHovered ? '#ffffff' : hexToRgba(color, 1);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 / zoomLevel;

            ctx.fillRect(x - hs_half, y - hs_half, hs, hs);
            ctx.strokeRect(x - hs_half, y - hs_half, hs, hs);
        });
    }

    getHitType(ann, posOnImage, zoomLevel, checkOnlyHandles = false) {
        if (ann.type !== 'polygon') return null;

        const hs = HANDLE_SIZE_SCREEN / zoomLevel;
        const hs_half = hs / 2;

        for (let i = 0; i < ann.points.length; i++) {
            const [x, y] = ann.points[i];
            const handleRect = { x: x - hs_half, y: y - hs_half, w: hs, h: hs };
            if (isPointInRect(posOnImage, handleRect)) {
                return `vertex-${i}`;
            }
        }

        if (checkOnlyHandles) return null;

        if (this._isPointInPolygon(posOnImage, ann.points)) {
            return 'move';
        }
        return null;
    }

    _isPointInPolygon(point, vs) {
        const x = point.x, y = point.y;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i][0], yi = vs[i][1];
            const xj = vs[j][0], yj = vs[j][1];
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    updateDrag(activeDragInfo, posOnImage, imgData) {
        const ann = activeDragInfo.annotationRef;
        const op = activeDragInfo.originalPoints;
        const imgWidth = imgData.originalWidth;
        const imgHeight = imgData.originalHeight;

        const clampedPos = clampPointToImage(posOnImage, imgWidth, imgHeight);

        const mouseDx = clampedPos.x - activeDragInfo.initialMousePosOnImage.x;
        const mouseDy = clampedPos.y - activeDragInfo.initialMousePosOnImage.y;

        if (activeDragInfo.type === 'move') {
            const tentativePoints = op.map(p => [p[0] + mouseDx, p[1] + mouseDy]);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            tentativePoints.forEach(p => {
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
                if (p[1] < minY) minY = p[1];
                if (p[1] > maxY) maxY = p[1];
            });

            let offsetX = 0, offsetY = 0;
            if (minX < 0) offsetX = -minX;
            else if (maxX > imgWidth) offsetX = imgWidth - maxX;
            if (minY < 0) offsetY = -minY;
            else if (maxY > imgHeight) offsetY = imgHeight - maxY;

            ann.points = tentativePoints.map(p => [p[0] + offsetX, p[1] + offsetY]);

        } else if (activeDragInfo.type.startsWith('vertex-')) {
            const vertexIndex = parseInt(activeDragInfo.type.split('-')[1]);
            if (vertexIndex >= 0 && vertexIndex < ann.points.length) {
                const newX = op[vertexIndex][0] + mouseDx;
                const newY = op[vertexIndex][1] + mouseDy;
                ann.points[vertexIndex][0] = Math.max(0, Math.min(newX, imgWidth));
                ann.points[vertexIndex][1] = Math.max(0, Math.min(newY, imgHeight));
            }
        }
    }
}