/**
 * 简单的事件发射器实现（TypeScript 版）
 * 用于键盘管理器和无障碍服务
 */
export type EventListener = (...args: any[]) => void;

export class EventEmitter {
  private _events: Record<string, EventListener[]> = {};

  on(event: string, listener: EventListener): this {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  }

  once(event: string, listener: EventListener): this {
    const onceWrapper: EventListener = (...args: any[]) => {
      this.off(event, onceWrapper);
      listener.apply(this, args);
    };
    return this.on(event, onceWrapper);
  }

  off(event: string, listener?: EventListener): this {
    const list = this._events[event];
    if (!list) return this;

    if (!listener) {
      delete this._events[event];
      return this;
    }

    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) delete this._events[event];
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const list = this._events[event];
    if (!list || list.length === 0) return false;
    // 复制，避免执行过程中修改
    const listeners = [...list];
    for (const l of listeners) {
      try {
        l.apply(this, args);
      } catch (e) {
        // 仅记录，避免中断其他监听器
        console.error(`Error in event listener for "${event}":`, e);
      }
    }
    return true;
  }

  listenerCount(event: string): number {
    return this._events[event]?.length ?? 0;
  }

  eventNames(): string[] {
    return Object.keys(this._events);
  }

  removeAllListeners(event?: string): this {
    if (event) delete this._events[event];
    else this._events = {};
    return this;
  }
}

export default EventEmitter;

