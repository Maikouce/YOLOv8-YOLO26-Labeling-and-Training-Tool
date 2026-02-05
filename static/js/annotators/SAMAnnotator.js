// static/js/annotators/SAMAnnotator.js

import { BaseAnnotator } from './BaseAnnotator.js';
import { clampRectangleToImage, clampPointToImage, getHandleRects, isPointInRect } from '../utils/geometryUtils.js';
import { hexToRgba } from '../utils/colorUtils.js';

const ASSIST_COLOR_POS = '#00FFFF';
const ASSIST_COLOR_NEG = '#FF0000';
const ASSIST_POINT_RADIUS = 8;
const HANDLE_SIZE_SCREEN = 14;
const BORDER_HIT_TOLERANCE = 5;
const ARROW_LEN = 20;

export class SAMAnnotator extends BaseAnnotator {
    constructor(bus) {
        super(bus);
        this.drawingMode = 'sam_assist';
        this.prompts = [];
        this.selectedPromptIndex = -1;

        // 【新增】模式状态: 'semantic' (默认, 提示词关联) 或 'standard' (单体)
        this.samMode = 'semantic';

        this.state = 'IDLE';
        this.pendingPrompt = null;

        this.dragStart = null;
        this.isDragging = false;
        this.isContinuousDrawing = true;

        this.requireOrientation = false;
        this.isShiftPressed = false;

        this.bus.on('imageIndexChanged', () => {
            this.clearPrompts();
        });

        document.addEventListener('keydown', (e) => { if(e.key==='Shift') { this.isShiftPressed = true; this.bus.emit('redraw'); } });
        document.addEventListener('keyup', (e) => { if(e.key==='Shift') { this.isShiftPressed = false; this.bus.emit('redraw'); } });
    }

    // 【新增】切换模式的方法
    toggleMode() {
        if (this.samMode === 'semantic') {
            this.samMode = 'standard';
            this.bus.emit('statusMessage', "已切换至: 单体辅助标注 (SAM Standard)", "success");
        } else {
            this.samMode = 'semantic';
            this.bus.emit('statusMessage', "已切换至: 提示词关联辅助标注 (SAM Semantic)", "info");
        }
        // 通知 UI 更新按钮文本
        this.bus.emit('samModeChanged', this.samMode);
    }

    startDrawing(posOnImage, currentLabel) {
        const imgData = this.bus.imageManager.getCurrentImage();
        if (!imgData) return;

        if (this.state === 'WAITING_DIRECTION') {
            this._finalizeDirection(posOnImage);
            return;
        }

        this.selectedPromptIndex = -1;
        this.state = 'DRAWING_PROMPT';
        this.dragStart = clampPointToImage(posOnImage, imgData.originalWidth, imgData.originalHeight);
        this.isDragging = true;
        this.isDrawing = true;
    }

    updateDrawing(posOnImage) {
    }

    endDrawing() { return null; }

    handleMouseUpInDrawing(posOnImage) {
        if (this.state === 'DRAWING_PROMPT' && this.isDragging) {
            this._finishPromptDrawing(posOnImage, this.isShiftPressed);
        }
    }

    _finishPromptDrawing(endPoint, isNegative) {
        const imgData = this.bus.imageManager.getCurrentImage();
        const minDragDistance = 5;

        const rawW = Math.abs(endPoint.x - this.dragStart.x);
        const rawH = Math.abs(endPoint.y - this.dragStart.y);
        const currentLabel = this.bus.labelManager.getCurrentLabel();

        let prompt = null;

        if (rawW < minDragDistance && rawH < minDragDistance) {
            // Point
            prompt = {
                type: 'point',
                data: [this.dragStart.x, this.dragStart.y],
                label: currentLabel.name,
                color: isNegative ? ASSIST_COLOR_NEG : currentLabel.color,
                isNegative: isNegative,
                center: { x: this.dragStart.x, y: this.dragStart.y }
            };
        } else {
            // Box
            const rect = clampRectangleToImage(
                Math.min(this.dragStart.x, endPoint.x),
                Math.min(this.dragStart.y, endPoint.y),
                rawW, rawH,
                imgData.originalWidth, imgData.originalHeight
            );
            if (rect.w > 0 && rect.h > 0) {
                prompt = {
                    type: 'box',
                    data: [rect.x, rect.y, rect.w, rect.h],
                    label: currentLabel.name,
                    color: isNegative ? ASSIST_COLOR_NEG : currentLabel.color,
                    isNegative: isNegative,
                    center: { x: rect.x + rect.w/2, y: rect.y + rect.h/2 }
                };
            }
        }

        if (prompt) {
            if (this.requireOrientation && !prompt.isNegative) {
                this.pendingPrompt = prompt;
                this.state = 'WAITING_DIRECTION';
                this.bus.emit('statusMessage', "请移动鼠标指定 OBB 主方向，再次点击确认。", "info", 3000);
            } else {
                this.prompts.push({
                    ...prompt,
                    rotation: 0
                });
                this.selectedPromptIndex = this.prompts.length - 1;
                this.state = 'IDLE';
                this.bus.emit('statusMessage', prompt.isNegative ? "已添加排除区域 (Negative)" : "辅助标注添加成功。", "success", 1000);
            }
        } else {
            this.state = 'IDLE';
        }

        this.isDragging = false;
        this.dragStart = null;
        this.isDrawing = (this.state !== 'IDLE');
        this.bus.emit('redraw');
    }

    _finalizeDirection(posOnImage) {
        if (!this.pendingPrompt) {
            this.state = 'IDLE';
            return;
        }
        const cx = this.pendingPrompt.center.x;
        const cy = this.pendingPrompt.center.y;
        const dx = posOnImage.x - cx;
        const dy = posOnImage.y - cy;
        const angle = Math.atan2(dy, dx);

        this.prompts.push({
            ...this.pendingPrompt,
            rotation: angle
        });

        this.pendingPrompt = null;
        this.state = 'IDLE';
        this.selectedPromptIndex = this.prompts.length - 1;
        this.isDrawing = false;
        this.bus.emit('redraw');
        this.bus.emit('statusMessage', "辅助标注添加成功 (含方向)。", "success", 1000);
    }

    changeLabelOfSelectedPrompt(newLabel) {
        if (this.selectedPromptIndex !== -1 && this.prompts[this.selectedPromptIndex]) {
            const p = this.prompts[this.selectedPromptIndex];
            p.label = newLabel.name;
            if (!p.isNegative) {
                p.color = newLabel.color;
            }
            this.bus.emit('redraw');
            this.bus.emit('statusMessage', `辅助标注标签更改为: ${newLabel.name}`, "info", 1000);
        }
    }

    deletePrompt(index) {
        if (index >= 0 && index < this.prompts.length) {
            this.prompts.splice(index, 1);
            this.selectedPromptIndex = -1;
            this.bus.emit('redraw');
            this.bus.emit('statusMessage', "辅助标记已删除", "info", 800);
        }
    }

    getHitType(posOnImage, zoomLevel) {
        const effectiveHandleSize = HANDLE_SIZE_SCREEN / zoomLevel;
        const borderTolerance = BORDER_HIT_TOLERANCE / zoomLevel;

        for (let i = this.prompts.length - 1; i >= 0; i--) {
            const p = this.prompts[i];

            if (p.type === 'box') {
                const rect = { x: p.data[0], y: p.data[1], w: p.data[2], h: p.data[3] };
                const handles = getHandleRects(rect, effectiveHandleSize);
                for (const handle of handles) {
                    if (isPointInRect(posOnImage, handle)) {
                        return { type: `prompt-${i}-${handle.type}`, index: i };
                    }
                }
                if (this._isPointNearBorder(posOnImage, rect, borderTolerance)) {
                    return { type: `prompt-${i}-move`, index: i };
                }
            } else if (p.type === 'point') {
                const hitRadius = effectiveHandleSize / 1.5;
                const pointRect = {
                    x: p.data[0] - hitRadius,
                    y: p.data[1] - hitRadius,
                    w: hitRadius * 2,
                    h: hitRadius * 2
                };
                if (isPointInRect(posOnImage, pointRect)) {
                    return { type: `prompt-${i}-move`, index: i };
                }
            }
        }
        return null;
    }

    _isPointNearBorder(p, rect, tolerance) {
        const l = rect.x;
        const r = rect.x + rect.w;
        const t = rect.y;
        const b = rect.y + rect.h;
        if (p.x < l - tolerance || p.x > r + tolerance || p.y < t - tolerance || p.y > b + tolerance) return false;
        const nearL = Math.abs(p.x - l) <= tolerance;
        const nearR = Math.abs(p.x - r) <= tolerance;
        const nearT = Math.abs(p.y - t) <= tolerance;
        const nearB = Math.abs(p.y - b) <= tolerance;
        return nearL || nearR || nearT || nearB;
    }

    updateDrag(activeDragInfo, posOnImage, imgData) {
        const parts = activeDragInfo.type.split('-');
        if (parts[0] !== 'prompt') return;
        const index = parseInt(parts[1]);
        const action = parts.slice(2).join('-');
        const prompt = this.prompts[index];
        if (!prompt) return;

        const op = activeDragInfo.originalData;
        const imgWidth = imgData.originalWidth;
        const imgHeight = imgData.originalHeight;
        const mouseDx = posOnImage.x - activeDragInfo.initialMousePosOnImage.x;
        const mouseDy = posOnImage.y - activeDragInfo.initialMousePosOnImage.y;

        if (prompt.type === 'point') {
            let newX = op[0] + mouseDx;
            let newY = op[1] + mouseDy;
            const clamped = clampPointToImage({x: newX, y: newY}, imgWidth, imgHeight);
            prompt.data = [clamped.x, clamped.y];
            prompt.center = {x: clamped.x, y: clamped.y};
        } else if (prompt.type === 'box') {
            let newX = op[0], newY = op[1], newW = op[2], newH = op[3];
            if (action === 'move') {
                newX = op[0] + mouseDx;
                newY = op[1] + mouseDy;
                newX = Math.max(0, Math.min(newX, imgWidth - op[2]));
                newY = Math.max(0, Math.min(newY, imgHeight - op[3]));
            } else {
                switch (action) {
                    case 'resize-tl': newX = op[0] + mouseDx; newY = op[1] + mouseDy; newW = op[2] - mouseDx; newH = op[3] - mouseDy; break;
                    case 'resize-tr': newY = op[1] + mouseDy; newW = op[2] + mouseDx; newH = op[3] - mouseDy; break;
                    case 'resize-br': newW = op[2] + mouseDx; newH = op[3] + mouseDy; break;
                    case 'resize-bl': newX = op[0] + mouseDx; newW = op[2] - mouseDx; newH = op[3] + mouseDy; break;
                    case 'resize-t': newY = op[1] + mouseDy; newH = op[3] - mouseDy; break;
                    case 'resize-r': newW = op[2] + mouseDx; break;
                    case 'resize-b': newH = op[3] + mouseDy; break;
                    case 'resize-l': newX = op[0] + mouseDx; newW = op[2] - mouseDx; break;
                }
            }
            const rect = clampRectangleToImage(newX, newY, newW, newH, imgWidth, imgHeight);
            prompt.data = [rect.x, rect.y, rect.w, rect.h];
            prompt.center = { x: rect.x + rect.w/2, y: rect.y + rect.h/2 };
        }
    }

    drawPreview(currentLabel, imgWidth, imgHeight, zoomLevel, ctx) {
        this.prompts.forEach((p, index) => {
            const isSelected = (index === this.selectedPromptIndex);
            const color = p.isNegative ? ASSIST_COLOR_NEG : ASSIST_COLOR_POS;

            ctx.strokeStyle = isSelected ? '#FFFFFF' : color;
            ctx.fillStyle = hexToRgba(color, isSelected ? 0.1 : 0.05);
            ctx.lineWidth = (isSelected ? 3 : 2) / zoomLevel;

            let cx, cy;

            if (p.type === 'box') {
                const [x, y, w, h] = p.data;
                cx = x + w/2; cy = y + h/2;
                ctx.setLineDash([5, 3]);
                ctx.strokeRect(x, y, w, h);
                ctx.fillRect(x, y, w, h);
                ctx.setLineDash([]);

                ctx.fillStyle = '#000000';
                ctx.font = `bold ${Math.max(14, 16/zoomLevel)}px Arial`;
                ctx.lineWidth = 3 / zoomLevel;
                ctx.strokeStyle = '#FFFFFF';
                const labelText = p.isNegative ? "Neg Box (-)" : `Rect: ${p.label}`;
                ctx.strokeText(labelText, x, y - 8/zoomLevel);
                ctx.fillText(labelText, x, y - 8/zoomLevel);

                if (isSelected) {
                    const handles = getHandleRects({x,y,w,h}, HANDLE_SIZE_SCREEN/zoomLevel);
                    handles.forEach(h => {
                        ctx.fillStyle = color;
                        ctx.fillRect(h.x, h.y, h.w, h.h);
                        ctx.strokeStyle = '#000';
                        ctx.lineWidth = 1/zoomLevel;
                        ctx.strokeRect(h.x, h.y, h.w, h.h);
                    });
                }

            } else if (p.type === 'point') {
                const [x, y] = p.data;
                cx = x; cy = y;
                const r = (isSelected ? ASSIST_POINT_RADIUS * 1.2 : ASSIST_POINT_RADIUS) / zoomLevel;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = isSelected ? '#FFFFFF' : color;
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1 / zoomLevel;
                ctx.stroke();

                ctx.fillStyle = '#000000';
                ctx.font = `bold ${Math.max(14, 16/zoomLevel)}px Arial`;
                ctx.lineWidth = 3 / zoomLevel;
                ctx.strokeStyle = '#FFFFFF';
                const labelText = p.isNegative ? "Neg (-)" : `Point: ${p.label}`;
                ctx.strokeText(labelText, x + r + 4, y + r);
                ctx.fillText(labelText, x + r + 4, y + r);
            }

            if (this.requireOrientation && p.rotation !== undefined && !p.isNegative) {
                const len = (ARROW_LEN * 2) / zoomLevel;
                const ex = cx + Math.cos(p.rotation) * len;
                const ey = cy + Math.sin(p.rotation) * len;
                this._drawArrowLine(ctx, cx, cy, ex, ey, zoomLevel, false);
            }
        });

        const pendingColor = this.isShiftPressed ? ASSIST_COLOR_NEG : ASSIST_COLOR_POS;

        if (this.state === 'DRAWING_PROMPT' && this.isDragging && this.dragStart && this.bus.canvasManager.eventForCurrentPos) {
            const currentPos = this.bus.canvasManager.getMousePosOnImage(this.bus.canvasManager.eventForCurrentPos);
            if (currentPos) {
                const w = Math.abs(currentPos.x - this.dragStart.x);
                const h = Math.abs(currentPos.y - this.dragStart.y);
                const x = Math.min(this.dragStart.x, currentPos.x);
                const y = Math.min(this.dragStart.y, currentPos.y);

                ctx.strokeStyle = pendingColor;
                ctx.lineWidth = 2 / zoomLevel;
                ctx.setLineDash([2, 2]);

                if (w < 5 && h < 5) {
                    ctx.beginPath();
                    ctx.arc(this.dragStart.x, this.dragStart.y, 5/zoomLevel, 0, Math.PI*2);
                    ctx.fillStyle = pendingColor;
                    ctx.fill();
                } else {
                    ctx.strokeRect(x, y, w, h);
                }
                ctx.setLineDash([]);
            }
        }
        else if (this.state === 'WAITING_DIRECTION' && this.pendingPrompt && this.bus.canvasManager.eventForCurrentPos) {
            const p = this.pendingPrompt;
            if (p.type === 'box') {
                const [x, y, w, h] = p.data;
                ctx.strokeStyle = ASSIST_COLOR_POS;
                ctx.lineWidth = 2 / zoomLevel;
                ctx.strokeRect(x, y, w, h);
            } else {
                const [x, y] = p.data;
                ctx.beginPath(); ctx.arc(x, y, 5/zoomLevel, 0, Math.PI*2); ctx.fillStyle=ASSIST_COLOR_POS; ctx.fill();
            }
            const currentPos = this.bus.canvasManager.getMousePosOnImage(this.bus.canvasManager.eventForCurrentPos);
            if (currentPos) {
                const cx = p.center.x;
                const cy = p.center.y;
                const angle = Math.atan2(currentPos.y - cy, currentPos.x - cx);
                this._drawArrowLine(ctx, cx, cy, currentPos.x, currentPos.y, zoomLevel, true);
            }
        }
    }

    _drawArrowLine(ctx, startX, startY, endX, endY, zoomLevel, isPending) {
        ctx.strokeStyle = isPending ? '#FF00FF' : 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 2 / zoomLevel;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        const angle = Math.atan2(endY - startY, endX - startX);
        const headLen = 10 / zoomLevel;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }

    clearPrompts() {
        this.prompts = [];
        this.selectedPromptIndex = -1;
        this.isDragging = false;
        this.dragStart = null;
        this.pendingPrompt = null;
        this.state = 'IDLE';
        this.bus.emit('redraw');
    }
}