// --- START OF FILE ImageManager.js ---

import { repairPolygonByMaskProjection, forceClockwise, isPolygonSelfIntersecting } from '../utils/geometryUtils.js';

// 配置：缓存半径 10
const CACHE_RANGE = 10;

export class ImageManager {
    constructor(bus, apiClient) {
        this.bus = bus;
        this.apiClient = apiClient;
        this.images = [];
        this.currentImageIndex = -1;
        this.currentSessionId = 0;
        this.activeLoaders = new Map();
    }
async fetchImageAndAnnotations(imgDataOrName) {
        let imgData = imgDataOrName;
        if (typeof imgDataOrName === 'string') {
            imgData = this.findImageByName(imgDataOrName);
        }
        if (!imgData) return;

        // 如果已经加载过，直接返回
        if (imgData.hasLoadedData && imgData.loadedImg) return;

        // 调用 API 获取图片数据
        try {
            const { img, metadata } = await this.apiClient.fetchImageAndAnnotations(imgData.name);

            // 更新内部状态
            imgData.loadedImg = img;
            imgData.hasLoadedData = true;
            // 确保尺寸被正确设置（这对于保存标注至关重要）
            if (imgData.originalWidth === 0) imgData.originalWidth = img.width;
            if (imgData.originalHeight === 0) imgData.originalHeight = img.height;

            // 如果后端返回了新的标注数据，也可以在这里合并，但通常保持现有引用即可
        } catch (e) {
            console.error(`Failed to fetch data for ${imgData.name}`, e);
            throw e;
        }
    }

    // 【新增】用于释放单张图片的内存（供批量操作使用）
    unloadSpecificImage(imageName) {
        const imgData = this.findImageByName(imageName);
        if (imgData && imgData.hasLoadedData) {
            // 只有当它不是当前显示的图片时才释放
            if (this.getCurrentImage() && this.getCurrentImage().name === imageName) return;

            imgData.loadedImg = null;
            imgData.hasLoadedData = false;
        }
    }
    getNavInfo() {
        return {
            currentImageIndex: this.currentImageIndex,
            totalImages: this.images.length,
        };
    }

    getCurrentImage() {
        return this.images[this.currentImageIndex];
    }

    getAllImages() {
        return this.images;
    }

    findImageByName(imageName) {
        return this.images.find(img => img.name === imageName);
    }

    async loadTaskData() {
        this.bus.emit('showLoading', true, "加载任务数据中...");
        try {
            const data = await this.apiClient.loadTaskMetadata();
            this.images = data.images.map(imgData => ({
                name: imgData.name,
                originalWidth: imgData.originalWidth,
                originalHeight: imgData.originalHeight,
                loadedImg: null,
                hasLoadedData: false,
                annotations: imgData.annotations || []
            }));
            this.images.sort((a, b) => a.name.localeCompare(b.name));
            this.bus.emit('labelsInitialized', data.labels);

            if (this.images.length > 0) {
                this.currentImageIndex = 0;
                await this.loadCurrentImage();
            } else {
                this.bus.emit('imageIndexChanged');
                this.bus.emit('resizeCanvas');
            }
        } catch (error) {
            console.error(error);
            this.bus.emit('statusMessage', "加载失败", "error");
        } finally {
            this.bus.emit('showLoading', false);
        }
    }

    _loadImageCore(index) {
        const imgData = this.images[index];
        if (!imgData) return Promise.reject("Index out of bounds");
        if (imgData.hasLoadedData && imgData.loadedImg) return Promise.resolve(imgData.loadedImg);

        const imageUrl = `/api/raw_image/${this.apiClient.owner}/${this.apiClient.taskName}/${imgData.name}`;

        return new Promise((resolve, reject) => {
            const img = new Image();
            this.activeLoaders.set(index, img);
            img.onload = () => {
                this.activeLoaders.delete(index);
                imgData.loadedImg = img;
                imgData.hasLoadedData = true;
                if (imgData.originalWidth === 0) imgData.originalWidth = img.width;
                if (imgData.originalHeight === 0) imgData.originalHeight = img.height;
                resolve(img);
            };
            img.onerror = () => {
                this.activeLoaders.delete(index);
                reject(new Error("Image load failed"));
            };
            img.src = imageUrl;
        });
    }

    _abortUnnecessaryLoads(targetIndex) {
        const minKeep = targetIndex - CACHE_RANGE;
        const maxKeep = targetIndex + CACHE_RANGE;
        for (const [index, imgObj] of this.activeLoaders.entries()) {
            if (index < minKeep || index > maxKeep) {
                imgObj.src = "";
                imgObj.onload = null;
                imgObj.onerror = null;
                this.activeLoaders.delete(index);
            }
        }
    }

    _releaseMemory() {
        const keepMin = this.currentImageIndex - CACHE_RANGE;
        const keepMax = this.currentImageIndex + CACHE_RANGE;
        this.images.forEach((img, index) => {
            if ((index < keepMin || index > keepMax) && img.hasLoadedData) {
                if (img.loadedImg) { img.loadedImg.src = ""; img.loadedImg = null; }
                img.hasLoadedData = false;
            }
        });
    }

    async _processBufferQueue(sessionId) {
        const center = this.currentImageIndex;
        const total = this.images.length;
        const tasks = [];
        for (let i = 1; i <= CACHE_RANGE; i++) {
            if (center + i < total) tasks.push(center + i);
            if (center - i >= 0) tasks.push(center - i);
        }
        for (const idx of tasks) {
            if (this.currentSessionId !== sessionId) return;
            const imgData = this.images[idx];
            if (!imgData.hasLoadedData) {
                try { await this._loadImageCore(idx); } catch (e) {}
            }
        }
    }

    async loadCurrentImage(forceReload = false) {
        if (this.currentImageIndex < 0 || this.currentImageIndex >= this.images.length) {
            this.bus.emit('imageIndexChanged');
            this.bus.emit('resizeCanvas');
            return;
        }

        this.currentSessionId++;
        const mySessionId = this.currentSessionId;
        this._abortUnnecessaryLoads(this.currentImageIndex);

        const imgData = this.images[this.currentImageIndex];
        this.bus.emit('imageIndexChanged');

        // --- 修复逻辑开始 ---
        // 如果命中缓存且不强制重载
        if (!forceReload && imgData.hasLoadedData && imgData.loadedImg) {
            // 1. 立即显示缓存的图片，保证极速体验
            this.bus.emit('imageLoaded', imgData);
            this._releaseMemory();
            this._processBufferQueue(mySessionId);

            // 2. 【关键修复】后台静默刷新标注数据 (解决多人协同不同步问题)
            try {
                // console.log(`Syncing annotations for ${imgData.name}...`);
                const meta = await this.apiClient.fetchAnnotationsOnly(imgData.name);

                // 如果当前 session 依然有效，更新数据并重绘
                if (this.currentSessionId === mySessionId) {
                    // 更新标注
                    imgData.annotations = meta.annotations || [];
                    // 通知 EventBus 重新绘制画布（不重新加载图片，只画框）
                    this.bus.emit('redraw');
                }
            } catch (e) {
                console.warn("Silent annotation sync failed:", e);
            }
            return;
        }
        // --- 修复逻辑结束 ---

        this.bus.emit('showLoading', true, `加载: ${imgData.name}`);
        try {
            await this._loadImageCore(this.currentImageIndex);
            if (this.currentSessionId === mySessionId) {
                this.bus.emit('imageLoaded', imgData);
                this._releaseMemory();
                this._processBufferQueue(mySessionId);
            }
        } catch (error) {
            if (this.currentSessionId === mySessionId) {
                this.bus.emit('statusMessage', `加载失败: ${error.message}`, "error");
            }
        } finally {
            if (this.currentSessionId === mySessionId) this.bus.emit('showLoading', false);
        }
    }

    async changeImage(direction) {
        const newIndex = this.currentImageIndex + direction;
        await this.jumpToImage(newIndex);
    }

    // 【新增】跳转到指定绝对索引
    async jumpToImage(index) {
        if (index < 0 || index >= this.images.length) {
             this.bus.emit('statusMessage', "页码超出范围", "warning");
             return;
        }
        if (index === this.currentImageIndex) return;

        // 自动保存逻辑
        if (this.currentImageIndex >= 0 && this.images[this.currentImageIndex].hasLoadedData) {
            try {
                await this.saveCurrentImageAnnotations();
            } catch (saveError) {
                if (!confirm(`保存失败！是否强行跳转？`)) return;
            }
        }

        this.currentImageIndex = index;
        await this.loadCurrentImage();
    }

    async uploadNewImage(name, dataUrl, width, height, labels) {
        const currentAnnotations = [];
        return await this.apiClient.saveAnnotation(name, width, height, currentAnnotations, labels, dataUrl);
    }

    async reloadTaskData() { await this.loadTaskData(); }

    async saveCurrentImageAnnotations() {
        if (this.currentImageIndex < 0 || this.currentImageIndex >= this.images.length) return;
        const imgData = this.images[this.currentImageIndex];
        const currentImageAnnotations = imgData.annotations || [];
        const labels = this.bus.labelManager.getLabels();
        const w = imgData.originalWidth;
        const h = imgData.originalHeight;

        // 修复多边形
        currentImageAnnotations.forEach(ann => {
             if (ann.type === 'polygon') {
                ann.points = ann.points.map(p => [Math.max(0, Math.min(p[0], w)), Math.max(0, Math.min(p[1], h))]);
                if (isPolygonSelfIntersecting(ann.points)) ann.points = repairPolygonByMaskProjection(ann.points, w, h);
                else ann.points = forceClockwise(ann.points);
             }
        });

        try {
            await this.apiClient.saveAnnotation(imgData.name, w, h, currentImageAnnotations, labels);
        } catch (error) {
            throw error;
        }
    }

    updateAnnotationColors(labelName, newColor) {
        this.images.forEach(img => {
            if (img.annotations) img.annotations.forEach(a => { if (a.label === labelName) a.color = newColor; });
        });
    }

    deleteAnnotationsByLabel(labelName) {
        this.images.forEach(img => {
            if (img.annotations) img.annotations = img.annotations.filter(a => a.label !== labelName);
        });
        this.bus.emit('redraw');
    }

    async deleteImages(imageNames) {
        if (!imageNames.length) return;
        this.bus.emit('showLoading', true, "删除中...");
        try {
            await this.apiClient.deleteImages(imageNames);
            const deletedNames = new Set(imageNames);
            const wasCurrentDeleted = deletedNames.has(this.getCurrentImage()?.name);
            this.images = this.images.filter(img => !deletedNames.has(img.name));

            if (this.images.length === 0) this.currentImageIndex = -1;
            else if (wasCurrentDeleted) this.currentImageIndex = Math.min(this.currentImageIndex, this.images.length - 1);

            if (this.currentImageIndex !== -1) await this.loadCurrentImage(true);
            else { this.bus.emit('resizeCanvas'); this.bus.emit('imageIndexChanged'); }

            this.bus.emit('statusMessage', "删除成功", "success");
        } catch (e) {
            this.bus.emit('statusMessage', `删除失败: ${e.message}`, "error");
        } finally {
            this.bus.emit('showLoading', false);
        }
    }
}