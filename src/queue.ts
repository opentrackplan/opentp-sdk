import type { DispatchedEvent, QueueConfig } from './types';

export class EventQueue {
  private queue: DispatchedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxSize: number;
  private readonly flushInterval: number;
  private readonly onFlush: (events: DispatchedEvent[]) => Promise<void>;

  constructor(config: QueueConfig, onFlush: (events: DispatchedEvent[]) => Promise<void>) {
    this.maxSize = config.maxSize ?? 10;
    this.flushInterval = config.flushInterval ?? 5000;
    this.onFlush = onFlush;

    // Start interval timer
    if (this.flushInterval > 0) {
      this.timer = setInterval(() => this.flush(), this.flushInterval);
    }
  }

  /** Add an event to the queue */
  push(event: DispatchedEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxSize) {
      this.flush();
    }
  }

  /** Flush all queued events */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    await this.onFlush(batch);
  }

  /** Stop the timer and flush remaining */
  async destroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
