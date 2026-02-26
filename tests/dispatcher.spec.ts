import { describe, expect, it, vi } from 'vitest';
import { Dispatcher } from '../src/dispatcher';
import type { Adapter, DispatchedEvent, Middleware } from '../src/types';

function mockEvent(): DispatchedEvent {
  return {
    area: 'auth',
    eventName: 'login',
    key: 'auth::login',
    payload: { event_name: 'login' },
    timestamp: Date.now(),
    metadata: {},
  };
}

function mockAdapter(name = 'mock'): Adapter & { calls: DispatchedEvent[] } {
  const calls: DispatchedEvent[] = [];
  return {
    name,
    send: vi.fn((event) => {
      calls.push(event);
    }),
    calls,
  };
}

describe('Dispatcher', () => {
  it('dispatches to single adapter', async () => {
    const adapter = mockAdapter();
    const dispatcher = new Dispatcher([adapter]);
    const event = mockEvent();

    await dispatcher.dispatch(event);

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].key).toBe('auth::login');
  });

  it('dispatches to multiple adapters', async () => {
    const adapter1 = mockAdapter('adapter1');
    const adapter2 = mockAdapter('adapter2');
    const dispatcher = new Dispatcher([adapter1, adapter2]);
    const event = mockEvent();

    await dispatcher.dispatch(event);

    expect(adapter1.calls).toHaveLength(1);
    expect(adapter2.calls).toHaveLength(1);
  });

  it('runs middleware before adapters', async () => {
    const adapter = mockAdapter();
    const middleware: Middleware = (event, next) => {
      next({ ...event, metadata: { ...event.metadata, enriched: true } });
    };
    const dispatcher = new Dispatcher([adapter], [middleware]);
    const event = mockEvent();

    await dispatcher.dispatch(event);

    expect(adapter.calls[0].metadata.enriched).toBe(true);
  });

  it('middleware can filter events', async () => {
    const adapter = mockAdapter();
    const middleware: Middleware = (event, next) => {
      // Don't call next — filter the event
      if (event.eventName === 'login') {
        // Filter out login events
        return;
      }
      next(event);
    };
    const dispatcher = new Dispatcher([adapter], [middleware]);
    const event = mockEvent();

    await dispatcher.dispatch(event);

    expect(adapter.calls).toHaveLength(0); // filtered
  });

  it('dispatches batch to adapters with sendBatch', async () => {
    const calls: DispatchedEvent[][] = [];
    const adapter: Adapter = {
      name: 'batch',
      send: vi.fn(),
      sendBatch: vi.fn((events) => {
        calls.push(events);
      }),
    };
    const dispatcher = new Dispatcher([adapter]);
    const events = [mockEvent(), mockEvent()];

    await dispatcher.dispatchBatch(events);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('falls back to send() for adapters without sendBatch', async () => {
    const adapter = mockAdapter();
    const dispatcher = new Dispatcher([adapter]);
    const events = [mockEvent(), mockEvent()];

    await dispatcher.dispatchBatch(events);

    expect(adapter.calls).toHaveLength(2);
  });

  it('runs middleware on batch events', async () => {
    const adapter = mockAdapter();
    const middleware: Middleware = (event, next) => {
      if (event.eventName !== 'login') {
        next(event);
      }
      // Filter login events
    };
    const dispatcher = new Dispatcher([adapter], [middleware]);
    const events = [mockEvent(), { ...mockEvent(), eventName: 'logout', key: 'auth::logout' }];

    await dispatcher.dispatchBatch(events);

    expect(adapter.calls).toHaveLength(1); // only logout
    expect(adapter.calls[0].eventName).toBe('logout');
  });
});
