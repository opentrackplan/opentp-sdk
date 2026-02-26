import type { Adapter, DispatchedEvent, Middleware } from './types';

export class Dispatcher {
  private adapters: Adapter[];
  private middlewareChain: Middleware[];

  constructor(adapters: Adapter[], middleware: Middleware[] = []) {
    this.adapters = adapters;
    this.middlewareChain = middleware;
  }

  /** Dispatch a single event through middleware → adapters */
  async dispatch(event: DispatchedEvent): Promise<void> {
    // Run through middleware chain
    const finalEvent = await this.runMiddleware(event);
    if (!finalEvent) return; // middleware filtered it out

    // Send to all adapters
    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          await adapter.send(finalEvent);
        } catch (err) {
          // Individual adapter errors shouldn't crash others
          throw new Error(`Adapter "${adapter.name}" error: ${(err as Error).message}`);
        }
      }),
    );
  }

  /** Dispatch a batch of events to adapters */
  async dispatchBatch(events: DispatchedEvent[]): Promise<void> {
    // Run each through middleware
    const processed: DispatchedEvent[] = [];
    for (const event of events) {
      const result = await this.runMiddleware(event);
      if (result) processed.push(result);
    }

    if (processed.length === 0) return;

    // Send to adapters — use sendBatch if available, otherwise send individually
    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          if (adapter.sendBatch) {
            await adapter.sendBatch(processed);
          } else {
            for (const event of processed) {
              await adapter.send(event);
            }
          }
        } catch (err) {
          throw new Error(`Adapter "${adapter.name}" batch error: ${(err as Error).message}`);
        }
      }),
    );
  }

  /** Run event through middleware chain */
  private runMiddleware(event: DispatchedEvent): Promise<DispatchedEvent | null> {
    return new Promise((resolve) => {
      if (this.middlewareChain.length === 0) {
        resolve(event);
        return;
      }

      let resolved = false;
      let index = 0;

      const next = (e: DispatchedEvent) => {
        if (resolved) return;

        index++;
        if (index >= this.middlewareChain.length) {
          resolved = true;
          resolve(e);
        } else {
          this.middlewareChain[index](e, next);
        }
      };

      // Start the chain
      this.middlewareChain[0](event, next);

      // If middleware doesn't call next synchronously, filter the event
      // Use setTimeout to check after the current call stack
      setTimeout(() => {
        if (!resolved && index === 0) {
          resolved = true;
          resolve(null);
        }
      }, 0);
    });
  }
}
