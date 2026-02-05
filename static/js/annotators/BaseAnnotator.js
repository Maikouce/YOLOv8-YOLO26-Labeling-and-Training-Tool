/**
 * 抽象基类：所有标注工具的接口定义
 */
export class BaseAnnotator {
    constructor(bus) {
        this.bus = bus;
        this.isDrawing = false;
        this.startPoint = null;
        // 新增：标识该工具是否为连续绘制模式（如多边形是 true，矩形是 false）
        // 连续绘制模式下，MouseUp 不会结束绘制，而是由工具自己控制生命周期
        this.isContinuousDrawing = false;
    }

    // Drawing methods (must be implemented by concrete classes)
    startDrawing(posOnImage, currentLabel) { throw new Error("Method 'startDrawing' must be implemented."); }
    updateDrawing(posOnImage) { /* Optional: updates preview state based on mouse move */ }

    // 对于连续绘制工具，endDrawing 通常不通过 MouseUp 触发，而是通过特定操作（如右键/闭合）触发
    endDrawing(endPoint, imgWidth, imgHeight, minDragDistance) { throw new Error("Method 'endDrawing' must be implemented."); }

    drawPreview(currentLabel, imgWidth, imgHeight, zoomLevel, ctx) { throw new Error("Method 'drawPreview' must be implemented."); }
    drawAnnotations(annotations, selectedInfo, hoveredInfo, zoomLevel, ctx, currentToolMode) { throw new Error("Method 'drawAnnotations' must be implemented."); }

    // Interaction methods (must be implemented by concrete classes)
    getHitType(ann, posOnImage, zoomLevel) { throw new Error("Method 'getHitType' must be implemented."); }
    updateDrag(activeDragInfo, posOnImage, imgData) { throw new Error("Method 'updateDrag' must be implemented."); }
}