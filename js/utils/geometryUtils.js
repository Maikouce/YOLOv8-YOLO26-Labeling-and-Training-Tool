// --- START OF FILE utils/geometryUtils.js ---

/**
 * 几何计算工具库
 */

// --- 基础矩形/点判定逻辑 ---

export function clampRectangleToImage(x, y, w, h, imgW, imgH) {
    let x1 = x;
    let y1 = y;
    let x2 = x + w;
    let y2 = y + h;

    x1 = Math.max(0, Math.min(x1, imgW));
    y1 = Math.max(0, Math.min(y1, imgH));
    x2 = Math.max(0, Math.min(x2, imgW));
    y2 = Math.max(0, Math.min(y2, imgH));

    return {
        x: x1,
        y: y1,
        w: x2 - x1,
        h: y2 - y1
    };
}


export function getHandleRects(rect, handleSize) {
    const { x, y, w, h } = rect;
    const half = handleSize / 2;
    return [
        { type: 'resize-tl', x: x - half, y: y - half, w: handleSize, h: handleSize },
        { type: 'resize-tr', x: x + w - half, y: y - half, w: handleSize, h: handleSize },
        { type: 'resize-br', x: x + w - half, y: y + h - half, w: handleSize, h: handleSize },
        { type: 'resize-bl', x: x - half, y: y + h - half, w: handleSize, h: handleSize },
        { type: 'resize-t', x: x + w / 2 - half, y: y - half, w: handleSize, h: handleSize },
        { type: 'resize-r', x: x + w - half, y: y + h / 2 - half, w: handleSize, h: handleSize },
        { type: 'resize-b', x: x + w / 2 - half, y: y + h - half, w: handleSize, h: handleSize },
        { type: 'resize-l', x: x - half, y: y + h / 2 - half, w: handleSize, h: handleSize },
    ];
}

export function isPointInRect(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
           point.y >= rect.y && point.y <= rect.y + rect.h;
}

// --- 多边形高级算法 ---

