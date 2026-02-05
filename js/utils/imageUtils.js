// static/js/utils/imageUtils.js

/**
 * 获取图片的 EXIF 方向
 * @param {Blob} file
 * @returns {Promise<number>} Orientation (1=Normal, 3=180, 6=90CW, 8=90CCW)
 */
export function getOrientation(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            const view = new DataView(event.target.result);
            if (view.getUint16(0, false) != 0xFFD8) return resolve(-2);
            const length = view.byteLength;
            let offset = 2;
            while (offset < length) {
                const marker = view.getUint16(offset, false);
                offset += 2;
                if (marker == 0xFFE1) {
                    if (view.getUint32(offset += 2, false) != 0x45786966) return resolve(-1);
                    const little = view.getUint16(offset += 6, false) == 0x4949;
                    offset += view.getUint32(offset + 4, little);
                    const tags = view.getUint16(offset, little);
                    offset += 2;
                    for (let i = 0; i < tags; i++) {
                        if (view.getUint16(offset + (i * 12), little) == 0x0112) {
                            return resolve(view.getUint16(offset + (i * 12) + 8, little));
                        }
                    }
                } else if ((marker & 0xFF00) != 0xFF00) break;
                else offset += view.getUint16(offset, false);
            }
            return resolve(-1);
        };
        reader.readAsArrayBuffer(file.slice(0, 64 * 1024)); // 只读前64KB
    });
}

/**
 * 根据 EXIF 方向纠正图片，返回一个新的 Image 对象
 */
export async function getRotatedImage(blob) {
    const orientation = await getOrientation(blob);
    const img = new Image();
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        img.onload = () => {
            // 如果方向正常(1)或未知(-1)，直接返回原图
            if (orientation <= 1) {
                resolve({ img, width: img.width, height: img.height, url });
                return;
            }

            // 创建离屏 Canvas 进行旋转矫正
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const width = img.width;
            const height = img.height;

            // 设置 Canvas 尺寸（如果是 90度或270度，宽高要互换）
            if (orientation > 4 && orientation < 9) {
                canvas.width = height;
                canvas.height = width;
            } else {
                canvas.width = width;
                canvas.height = height;
            }

            // 旋转上下文
            switch (orientation) {
                case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
                case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
                case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
                case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
                case 6: ctx.transform(0, 1, -1, 0, height, 0); break; // 90 CW
                case 7: ctx.transform(0, -1, -1, 0, height, width); break;
                case 8: ctx.transform(0, -1, 1, 0, 0, width); break; // 90 CCW
                default: break;
            }

            ctx.drawImage(img, 0, 0);

            // 导出为新的 Image 对象
            const newImg = new Image();
            newImg.onload = () => {
                // 释放旧 URL 内存
                URL.revokeObjectURL(url);
                resolve({ img: newImg, width: canvas.width, height: canvas.height, wasRotated: true });
            };
            newImg.src = canvas.toDataURL();
        };
        img.onerror = reject;
        img.src = url;
    });
}