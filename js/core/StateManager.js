const MAX_UNDO_STATES = 20;

export class StateManager {
    constructor(bus, imageManager) {
        this.bus = bus;
        this.imageManager = imageManager;
        this.undoStack = [];
        this.bus.on('imageLoaded', this.resetStack.bind(this));
        // 移除对 'pushUndoState' 的监听，现在由外部模块同步调用 pushToUndoStack()
    }

    resetStack() {
        this.undoStack = [];
    }

    /**
     * Pushes a deep copy of the current image's annotations onto the stack.
     */
    pushToUndoStack() {
        const currentImage = this.imageManager.getCurrentImage();
        if (!currentImage) return;

        // Deep copy current image's annotations
        const annotationsToSave = JSON.parse(JSON.stringify(currentImage.annotations || []));

        this.undoStack.push({ imageName: currentImage.name, annotationsData: annotationsToSave });

        if (this.undoStack.length > MAX_UNDO_STATES) {
            this.undoStack.shift();
        }
    }

    handleUndo() {
        if (this.undoStack.length === 0) {
            this.bus.emit('statusMessage', "没有操作可以撤销。", "info");
            return false;
        }
        const lastState = this.undoStack.pop();

        const targetImage = this.imageManager.findImageByName(lastState.imageName);

        if (targetImage) {
            // Restore annotations data
            targetImage.annotations = JSON.parse(JSON.stringify(lastState.annotationsData));

            if (targetImage === this.imageManager.getCurrentImage()) {
                // Notify canvas to clear selection states specific to annotation manipulation
                this.bus.canvasManager.clearSelection();
                this.bus.emit('redraw');
            }
            this.bus.emit('statusMessage', `对图片 ${lastState.imageName} 的操作已撤销。`, "success");
            return true;
        } else {
            this.bus.emit('statusMessage', `无法找到图片 ${lastState.imageName} 进行撤销。`, "error");
            return false;
        }
    }
}