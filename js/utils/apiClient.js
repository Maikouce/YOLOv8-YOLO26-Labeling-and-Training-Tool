// static/js/utils/apiClient.js

export class APIClient {
    constructor(owner, taskName) {
        this.owner = owner;
        this.taskName = taskName;
        this.baseUrl = '/api';
    }

    async loadTaskMetadata() {
        const response = await fetch(`${this.baseUrl}/task_data/${this.owner}/${this.taskName}`);
        if (!response.ok) throw new Error("Failed to load task metadata");
        return await response.json();
    }

    async fetchImageAndAnnotations(imageName) {
        const response = await fetch(`${this.baseUrl}/image_data/${this.owner}/${this.taskName}/${imageName}`);
        if (!response.ok) throw new Error("Failed to load image data");
        const data = await response.json();

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ img, metadata: data });
            img.onerror = reject;
            img.src = data.data;
        });
    }

    async saveAnnotation(imageName, width, height, annotations, labels, imageData = null) {
        const payload = {
            owner: this.owner,
            taskName: this.taskName,
            imageName: imageName,
            imageWidth: width,
            imageHeight: height,
            annotations: annotations,
            labels: labels,
            imageData: imageData
        };

        const response = await fetch(`${this.baseUrl}/save_annotation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Save failed");
        }
        return await response.json();
    }

    async saveLabels(labels) {
        const payload = {
            owner: this.owner,
            taskName: this.taskName,
            labels: labels
        };

        const response = await fetch(`${this.baseUrl}/save_labels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Save labels failed");
        }
        return await response.json();
    }

    async uploadDataset(formData) {
        if (!formData.has('owner')) formData.append('owner', this.owner);
        if (!formData.has('taskName')) formData.append('taskName', this.taskName);

        const response = await fetch(`${this.baseUrl}/upload_dataset`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Upload failed");
        }
        return await response.json();
    }

    async deleteImages(imageNames) {
        const response = await fetch(`${this.baseUrl}/delete_images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner: this.owner,
                taskName: this.taskName,
                imageNames: imageNames
            })
        });
        if (!response.ok) throw new Error("Delete failed");
        return await response.json();
    }


     async fetchImageAndAnnotations(imageName) {
        // 原有方法保持不变
        const response = await fetch(`${this.baseUrl}/image_data/${this.owner}/${this.taskName}/${imageName}`);
        if (!response.ok) throw new Error("Failed to load image data");
        const data = await response.json();

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ img, metadata: data });
            img.onerror = reject;
            img.src = data.data;
        });
    }

    // 【新增】只获取标注数据，用于同步
    async fetchAnnotationsOnly(imageName) {
        // 添加 meta_only=true 参数
        const response = await fetch(`${this.baseUrl}/image_data/${this.owner}/${this.taskName}/${imageName}?meta_only=true`);
        if (!response.ok) throw new Error("Failed to load annotations");
        return await response.json(); // 返回 { annotations: [], ... }
    }
}