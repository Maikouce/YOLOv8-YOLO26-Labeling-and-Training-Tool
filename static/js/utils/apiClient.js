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

    uploadDataset(formData, onProgress) {
        // 【关键修复点】：手动追加 owner 和 taskName
        // 这里的 this.owner 和 this.taskName 是在 constructor 里保存的
        if (!formData.has('owner')) {
            formData.append('owner', this.owner);
        }
        if (!formData.has('taskName')) {
            formData.append('taskName', this.taskName);
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${this.baseUrl}/upload_dataset`);

            if (xhr.upload && onProgress) {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percentComplete = (event.loaded / event.total) * 100;
                        onProgress(percentComplete);
                    }
                };
            }

            xhr.onload = () => {
                try {
                    const response = JSON.parse(xhr.response);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || xhr.statusText));
                    }
                } catch (e) {
                    reject(new Error("服务器响应格式错误"));
                }
            };

            xhr.onerror = () => reject(new Error("网络连接失败"));
            xhr.send(formData);
        });
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

    // 【修改】新增 sam_mode 参数 (semantic / standard)
    async runSAMInference(imageName, prompts, confidence = 0.6, sam_mode = 'semantic') {
        const response = await fetch(`${this.baseUrl}/sam/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner: this.owner,
                taskName: this.taskName,
                imageName: imageName,
                prompts: prompts,
                confidence: confidence,
                samMode: sam_mode // 传递给后端
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "SAM inference failed");
        }
        return await response.json();
    }

    async runAutoAnnotation(imageName, promptConfig, confidence) {
        const response = await fetch(`${this.baseUrl}/sam/auto_annotate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner: this.owner,
                taskName: this.taskName,
                imageName: imageName,
                promptConfig: promptConfig,
                confidence: confidence
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Auto annotation failed");
        }
        return await response.json();
    }
}