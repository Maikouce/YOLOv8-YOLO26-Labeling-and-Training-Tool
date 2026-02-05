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

export function clampPointToImage(p, imgW, imgH) {
    return {
        x: Math.max(0, Math.min(p.x, imgW)),
        y: Math.max(0, Math.min(p.y, imgH))
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

export function isPolygonSelfIntersecting(points) {
    const n = points.length;
    if (n < 3) return false;

    const pts = points.map(p => ({ x: p[0], y: p[1] }));
    const EPSILON = 1e-9;

    const onSegment = (p, r, q) => {
        return q.x <= Math.max(p.x, r.x) + EPSILON && q.x >= Math.min(p.x, r.x) - EPSILON &&
               q.y <= Math.max(p.y, r.y) + EPSILON && q.y >= Math.min(p.y, r.y) - EPSILON;
    };

    const orientation = (p, q, r) => {
        const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
        if (Math.abs(val) < EPSILON) return 0;
        return (val > 0) ? 1 : 2;
    };

    const doIntersect = (p1, q1, p2, q2) => {
        const o1 = orientation(p1, q1, p2);
        const o2 = orientation(p1, q1, q2);
        const o3 = orientation(p2, q2, p1);
        const o4 = orientation(p2, q2, q1);

        if (o1 !== o2 && o3 !== o4) return true;
        if (o1 === 0 && onSegment(p1, p2, q1)) return true;
        if (o2 === 0 && onSegment(p1, q2, q1)) return true;
        if (o3 === 0 && onSegment(p2, p1, q2)) return true;
        if (o4 === 0 && onSegment(p2, q1, q2)) return true;
        return false;
    };

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(i - j) <= 1) continue;
            if (i === 0 && j === n - 1) continue;

            const p1 = pts[i], q1 = pts[(i + 1) % n];
            const p2 = pts[j], q2 = pts[(j + 1) % n];

            if (Math.max(p1.x, q1.x) < Math.min(p2.x, q2.x) ||
                Math.max(p2.x, q2.x) < Math.min(p1.x, q1.x) ||
                Math.max(p1.y, q1.y) < Math.min(p2.y, q2.y) ||
                Math.max(p2.y, q2.y) < Math.min(p1.y, q1.y)) {
                continue;
            }

            if (doIntersect(p1, q1, p2, q2)) {
                return true;
            }
        }
    }
    return false;
}

export function forceClockwise(points) {
    if (points.length < 3) return points;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        sum += (p2[0] - p1[0]) * (p2[1] + p1[1]);
    }
    if (sum < 0) {
        return points.slice().reverse();
    }
    return points;
}

export function calculatePolygonArea(points) {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i][0] * points[j][1];
        area -= points[j][0] * points[i][1];
    }
    return Math.abs(area) / 2;
}

export function repairPolygonByMaskProjection(points, originalW, originalH) {
    if (points.length < 3) return points;

    const PADDING = 20;
    const MAX_DIM_LIMIT = 4000;
    const maxDim = Math.max(originalW, originalH);
    const scaleFactor = maxDim > MAX_DIM_LIMIT ? (MAX_DIM_LIMIT / maxDim) : 1;

    const canvasW = Math.ceil(originalW * scaleFactor) + (PADDING * 2);
    const canvasH = Math.ceil(originalH * scaleFactor) + (PADDING * 2);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.translate(PADDING, PADDING);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(points[0][0] * scaleFactor, points[0][1] * scaleFactor);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0] * scaleFactor, points[i][1] * scaleFactor);
    }
    ctx.closePath();

    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
    const data = imgData.data;
    const width = canvasW;
    const height = canvasH;

    let startX = -1, startY = -1;
    outerLoop: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 128) {
                startX = x;
                startY = y;
                break outerLoop;
            }
        }
    }

    if (startX === -1) return points;

    const contour = traceMooreNeighbor(data, width, height, startX, startY);

    const restoredPoints = contour.map(p => [
        (p[0] - PADDING) / scaleFactor,
        (p[1] - PADDING) / scaleFactor
    ]);

    const simplified = simplifyPoints(restoredPoints, 1.0 / scaleFactor);

    return forceClockwise(simplified);
}

function traceMooreNeighbor(data, width, height, startX, startY) {
    const contour = [];
    const isSolid = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        return data[(y * width + x) * 4 + 3] > 128;
    };

    const offsets = [
        [0, -1], [1, -1], [1, 0], [1, 1],
        [0, 1], [-1, 1], [-1, 0], [-1, -1]
    ];

    let cx = startX;
    let cy = startY;
    let backtrackDir = 6;

    contour.push([cx, cy]);
    const maxSteps = width * height * 2;
    let steps = 0;

    while (steps < maxSteps) {
        steps++;
        let foundNext = false;

        for (let i = 0; i < 8; i++) {
            const dirIdx = (backtrackDir + i + 1) % 8;
            const nx = cx + offsets[dirIdx][0];
            const ny = cy + offsets[dirIdx][1];

            if (isSolid(nx, ny)) {
                cx = nx;
                cy = ny;
                contour.push([cx, cy]);
                backtrackDir = (dirIdx + 4) % 8;
                foundNext = true;
                break;
            }
        }

        if (!foundNext) break;
        if (cx === startX && cy === startY) break;
    }

    return contour;
}

export function simplifyPoints(points, tolerance) {
    if (points.length <= 2) return points;

    const sqTolerance = tolerance * tolerance;
    let maxSqDist = 0;
    let index = 0;

    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const sqDist = getSqSegDist(points[i], first, last);
        if (sqDist > maxSqDist) {
            index = i;
            maxSqDist = sqDist;
        }
    }

    if (maxSqDist > sqTolerance) {
        const left = simplifyPoints(points.slice(0, index + 1), tolerance);
        const right = simplifyPoints(points.slice(index), tolerance);
        return left.slice(0, left.length - 1).concat(right);
    } else {
        return [first, last];
    }
}

function getSqSegDist(p, p1, p2) {
    let x = p1[0], y = p1[1];
    let dx = p2[0] - x, dy = p2[1] - y;

    if (dx !== 0 || dy !== 0) {
        const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
            x = p2[0];
            y = p2[1];
        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }

    dx = p[0] - x;
    dy = p[1] - y;

    return dx * dx + dy * dy;
}

// --- OBB 算法 ---

export function rotatePoint(p, center, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
        x: center.x + (dx * cos - dy * sin),
        y: center.y + (dx * sin + dy * cos)
    };
}

export function isPointInOBB(point, obb) {
    const { x, y, w, h, rotation } = obb;
    const localP = rotatePoint(point, { x, y }, -rotation);
    return localP.x >= x - w / 2 && localP.x <= x + w / 2 &&
           localP.y >= y - h / 2 && localP.y <= y + h / 2;
}

export function getOBBHandles(obb, handleSize) {
    const { x, y, w, h, rotation } = obb;
    const hw = w / 2;
    const hh = h / 2;
    const center = {x, y};

    const rawHandles = [
        { type: 'resize-tl', x: x - hw, y: y - hh },
        { type: 'resize-tr', x: x + hw, y: y - hh },
        { type: 'resize-br', x: x + hw, y: y + hh },
        { type: 'resize-bl', x: x - hw, y: y + hh },
    ];

    return rawHandles.map(h => {
        const rotP = rotatePoint({x: h.x, y: h.y}, center, rotation);
        return {
            type: h.type,
            x: rotP.x - handleSize/2,
            y: rotP.y - handleSize/2,
            w: handleSize,
            h: handleSize,
            centerX: rotP.x,
            centerY: rotP.y
        };
    });
}

// 【新增】核心算法：计算指定方向的最小外接矩形
export function fitOBBWithOrientation(points, angle) {
    if (!points || points.length < 3) return null;

    // 1. 构建旋转矩阵 (逆向旋转，将目标方向对齐到 X 轴)
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // 2. 旋转所有点并计算 AABB
    for (const p of points) {
        const rx = p[0] * cos - p[1] * sin;
        const ry = p[0] * sin + p[1] * cos;

        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
    }

    // 3. 计算旋转后坐标系下的中心和宽高
    const w = maxX - minX;
    const h = maxY - minY;
    const cx_rot = (minX + maxX) / 2;
    const cy_rot = (minY + maxY) / 2;

    // 4. 将中心点旋转回原始坐标系
    const cos_orig = Math.cos(angle);
    const sin_orig = Math.sin(angle);

    const cx = cx_rot * cos_orig - cy_rot * sin_orig;
    const cy = cx_rot * sin_orig + cy_rot * cos_orig;

    return {
        x: cx,
        y: cy,
        w: w,
        h: h,
        rotation: angle
    };
}