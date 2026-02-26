import { describe, expect, it, vi } from 'vitest';
import { createTracker } from '../src/tracker';
import type { Adapter, TrackingEvent } from '../src/types';

// Helper to wait for async operations (need to wait for multiple ticks)
const waitForDispatch = () => new Promise((resolve) => setTimeout(resolve, 10));

// Mock adapter
function mockAdapter(): Adapter & {
  calls: Array<{ key: string; payload: Record<string, unknown> }>;
} {
  const calls: Array<{ key: string; payload: Record<string, unknown> }> = [];
  return {
    name: 'mock',
    send(event) {
      calls.push({ key: event.key, payload: event.payload });
    },
    calls,
  };
}

// Mock events (simulates generated SDK output)
const mockEvents = {
  auth: {
    login: {
      key: 'auth::login',
      constants: { event_name: 'login' },
      buildPayload: (params: { auth_method: string }) => ({
        event_name: 'login',
        ...params,
      }),
    } as TrackingEvent<{ auth_method: string }>,
    logout: {
      key: 'auth::logout',
      constants: { event_name: 'logout' },
      buildPayload: () => ({ event_name: 'logout' }),
    } as TrackingEvent<void>,
  },
};

describe('createTracker', () => {
  it('dispatches event with params to adapter', async () => {
    const adapter = mockAdapter();
    const tracker = createTracker({
      events: mockEvents,
      adapters: [adapter],
      consent: { defaultState: { analytics: true } },
    });

    tracker.auth.login({ auth_method: 'google' });
    await waitForDispatch();

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].key).toBe('auth::login');
    expect(adapter.calls[0].payload).toEqual({
      event_name: 'login',
      auth_method: 'google',
    });
  });

  it('dispatches event without params', async () => {
    const adapter = mockAdapter();
    const tracker = createTracker({
      events: mockEvents,
      adapters: [adapter],
      consent: { defaultState: { analytics: true } },
    });

    tracker.auth.logout();
    await waitForDispatch();

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].key).toBe('auth::logout');
    expect(adapter.calls[0].payload).toEqual({ event_name: 'logout' });
  });

  it('sends to multiple adapters', async () => {
    const adapter1 = mockAdapter();
    const adapter2 = mockAdapter();
    const tracker = createTracker({
      events: mockEvents,
      adapters: [adapter1, adapter2],
      consent: { defaultState: { analytics: true } },
    });

    tracker.auth.login({ auth_method: 'email' });
    await waitForDispatch();

    expect(adapter1.calls).toHaveLength(1);
    expect(adapter2.calls).toHaveLength(1);
  });

  it('respects consent — blocks when not consented', async () => {
    const adapter = mockAdapter();
    const tracker = createTracker({
      events: mockEvents,
      adapters: [adapter],
      consent: { defaultState: { analytics: false } },
    });

    tracker.auth.login({ auth_method: 'google' });
    await waitForDispatch();
    expect(adapter.calls).toHaveLength(0); // blocked

    tracker.setConsent({ analytics: true });
    tracker.auth.login({ auth_method: 'google' });
    await waitForDispatch();
    expect(adapter.calls).toHaveLength(1); // allowed
  });

  it('runs middleware', async () => {
    const adapter = mockAdapter();
    const tracker = createTracker({
      events: mockEvents,
      adapters: [adapter],
      consent: { defaultState: { analytics: true } },
      middleware: [
        (event, next) => {
          // Add metadata
          next({ ...event, metadata: { ...event.metadata, enriched: true } });
        },
      ],
    });

    tracker.auth.login({ auth_method: 'google' });
    await waitForDispatch();
    expect(adapter.calls).toHaveLength(1);
  });

  it('middleware can filter events', async () => {
    const adapter = mockAdapter();
    const tracker = createTracker({
      events: mockEvents,
      adapters: [adapter],
      consent: { defaultState: { analytics: true } },
      middleware: [
        (event, next) => {
          // Drop logout events
          if (event.eventName !== 'logout') next(event);
        },
      ],
    });

    tracker.auth.login({ auth_method: 'google' });
    tracker.auth.logout();
    await waitForDispatch();

    expect(adapter.calls).toHaveLength(1); // only login
  });
});
