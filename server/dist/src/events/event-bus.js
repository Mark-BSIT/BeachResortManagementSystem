import { EventEmitter } from 'node:events';
class TypedEventBus {
    emitter = new EventEmitter();
    on(name, listener) {
        this.emitter.on(name, listener);
    }
    emit(event) {
        this.emitter.emit(event.name, event);
    }
}
export const eventBus = new TypedEventBus();
