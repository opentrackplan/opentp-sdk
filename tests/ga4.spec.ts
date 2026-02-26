// tests/ga4.spec.ts

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ga4 } from '../src/adapters/ga4';
import type { DispatchedEvent } from '../src/types';

function makeEvent(overrides: Partial<DispatchedEvent> = {}): DispatchedEvent {
  return {
    key: 'auth::login',
    area: 'auth',
    eventName: 'login',
    payload: { event_name: 'login', auth_method: 'google' },
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('ga4 adapter', () => {
  let gtagCalls: Array<unknown[]>;
  let mockGtag: (...args: unknown[]) => void;

  beforeEach(() => {
    gtagCalls = [];
    mockGtag = (...args: unknown[]) => gtagCalls.push(args);
  });

  it('sends event via gtag', () => {
    const adapter = ga4({ measurementId: 'G-TEST', gtag: mockGtag });
    adapter.init?.();
    adapter.send(makeEvent());

    expect(gtagCalls).toHaveLength(1);
    expect(gtagCalls[0][0]).toBe('event');
    expect(gtagCalls[0][1]).toBe('login');
    expect(gtagCalls[0][2]).toEqual({
      auth_method: 'google',
      send_to: 'G-TEST',
    });
  });

  it('uses eventNameMap override', () => {
    const adapter = ga4({
      measurementId: 'G-TEST',
      gtag: mockGtag,
      eventNameMap: { 'auth::login': 'user_login' },
    });
    adapter.send(makeEvent());

    expect(gtagCalls[0][1]).toBe('user_login');
  });

  it('applies parameterMap', () => {
    const adapter = ga4({
      measurementId: 'G-TEST',
      gtag: mockGtag,
      parameterMap: { auth_method: 'method' },
    });
    adapter.send(makeEvent());

    expect(gtagCalls[0][2]).toHaveProperty('method', 'google');
    expect(gtagCalls[0][2]).not.toHaveProperty('auth_method');
  });

  it('excludes specified fields', () => {
    const adapter = ga4({
      measurementId: 'G-TEST',
      gtag: mockGtag,
      excludeFields: ['auth_method'],
    });
    adapter.send(makeEvent());

    expect(gtagCalls[0][2]).not.toHaveProperty('auth_method');
  });

  it('excludes event_name from parameters', () => {
    const adapter = ga4({ measurementId: 'G-TEST', gtag: mockGtag });
    adapter.send(makeEvent());

    expect(gtagCalls[0][2]).not.toHaveProperty('event_name');
  });

  it('falls back to dataLayer when gtag missing and tolerant', () => {
    const dataLayer: unknown[] = [];
    (globalThis as any).window = { dataLayer };

    const adapter = ga4({ measurementId: 'G-TEST', tolerateMissingGtag: true, warnIfMissing: false });
    adapter.send(makeEvent());

    expect(dataLayer).toHaveLength(1);
    expect((dataLayer[0] as any).event).toBe('login');

    delete (globalThis as any).window;
  });

  it('pushes to dataLayer when pushToDataLayer is true', () => {
    const dataLayer: unknown[] = [];
    (globalThis as any).window = { dataLayer };

    const adapter = ga4({
      measurementId: 'G-TEST',
      gtag: mockGtag,
      pushToDataLayer: true,
    });
    adapter.send(makeEvent());

    expect(gtagCalls).toHaveLength(1); // sent via gtag
    expect(dataLayer).toHaveLength(1); // also pushed to dataLayer
    expect((dataLayer[0] as any).opentp_key).toBe('auth::login');

    delete (globalThis as any).window;
  });

  it('sets user properties on init', () => {
    const adapter = ga4({
      measurementId: 'G-TEST',
      gtag: mockGtag,
      userProperties: { plan: 'premium' },
    });
    adapter.init?.();

    expect(gtagCalls).toHaveLength(1);
    expect(gtagCalls[0]).toEqual(['set', 'user_properties', { plan: 'premium' }]);
  });
});
