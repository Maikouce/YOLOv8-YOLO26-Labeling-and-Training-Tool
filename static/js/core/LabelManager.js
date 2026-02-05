export class LabelManager {
    constructor(bus, imageManager) {
        this.bus = bus;
        this.imageManager = imageManager;
        this.labels = []; // { name, color }
        this.currentLabel = null;
    }

    initialize(labels) {
        this.labels = labels || [];
        if (this.labels.length > 0 && !this.currentLabel) {
            this.selectLabel(this.labels[0]);
        }
        this.bus.emit('labelsUpdated');
    }

    getLabels() {
        return this.labels;
    }

    getCurrentLabel() {
        return this.currentLabel;
    }

    addLabel(name, color) {
        if (this.labels.find(l => l.name === name)) {
            throw new Error("标签已存在！");
        }
        const newLabel = { name, color };
        this.labels.push(newLabel);
        this.selectLabel(newLabel);
        this.bus.emit('labelsUpdated');
        this.bus.emit('statusMessage', `标签 "${name}" 已添加`, "success");
    }

    /**
     * 设置全局选中标签，并更新侧边栏高亮。
     */
    selectLabel(label) {
        this.currentLabel = label;
        this.bus.emit('labelsUpdated');
        this.bus.emit('statusMessage', `已选中标签: ${label.name}`, "info", 1500);
    }

    updateLabelColor(labelName, newColor) {
        const labelIndex = this.labels.findIndex(l => l.name === labelName);
        if (labelIndex === -1) return;

        this.labels[labelIndex].color = newColor;

        // Update all annotations across all images that use this label
        this.imageManager.updateAnnotationColors(labelName, newColor);

        if (this.currentLabel && this.currentLabel.name === labelName) {
            this.currentLabel.color = newColor;
        }

        this.bus.emit('labelsUpdated');
        this.bus.emit('redraw');
        this.bus.emit('statusMessage', `标签 "${labelName}" 颜色已更新`, "success");
    }

    deleteLabel(labelName) {
        this.labels = this.labels.filter(l => l.name !== labelName);

        if (this.currentLabel && this.currentLabel.name === labelName) {
            this.currentLabel = this.labels.length > 0 ? this.labels[0] : null;
            if (this.currentLabel) {
                 this.selectLabel(this.currentLabel);
            }
        }

        // Delete associated annotations
        this.imageManager.deleteAnnotationsByLabel(labelName);

        this.bus.emit('labelsUpdated');
        this.bus.emit('redraw');
        this.bus.emit('statusMessage', `标签 "${labelName}" 及相关标注已删除。`, "success");
    }
}