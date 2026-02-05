export class EventBus {
    constructor() {
        this.listeners = {};
        // Centralized storage for easy module dependency injection
        this.canvasManager = null;
        this.labelManager = null;
        this.stateManager = null; // FIX: 添加 stateManager 引用
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(
                cb => cb !== callback
            );
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            // Run handlers asynchronously to prevent blocking the caller thread
            // Note: State saving operations should be called synchronously outside the bus.
            setTimeout(() => {
                this.listeners[event].forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`Error in event handler for ${event}:`, error);
                    }
                });
            }, 0);
        }
    }
}