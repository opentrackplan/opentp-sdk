// tests/amplitude.spec.ts

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { amplitude } from '../src/adapters/amplitude';
import type { DispatchedEvent } from '../src/types';

function makeEvent(overrides: Partial<DispatchedEvent> = {}): DispatchedEvent {
  return {
    key: 'auth::login',
    area: 'auth',
    eventName: 'login',
    payload: {
      event_name: 'login_success',
      user_id: 'U-12345',
      app_version: '2.1.0',
      auth_method: 'google',
    },
    timestamp: 1700000000000,
    metadata: {},
    ...overrides,
  };
}

function mockFetch(status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ code: status, events_ingested: 1, server_upload_time: Date.now() }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }) as any;
  return { fn, calls };
}

function parseFetchBody(calls: Array<{ url: string; init: any }>, index = 0) {
  return JSON.parse(calls[index].init.body);
}

// ─── HTTP Mode — Event Mapping ───

describe('amplitude adapter — http mode — event mapping', () => {
  it('sends event to Amplitude HTTP API', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api2.amplitude.com/2/httpapi');

    const body = parseFetchBody(calls);
    expect(body.api_key).toBe('test-key');
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event_type).toBe('login_success');
  });

  it('uses eventNameMap override', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      eventNameMap: { 'auth::login': 'User Signed In' },
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].event_type).toBe('User Signed In');
  });

  it('falls back to key-based name when event_name missing', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent({
      payload: { user_id: 'U-12345', auth_method: 'google' },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].event_type).toBe('auth_login');
  });

  it('extracts user_id from payload to top-level', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].user_id).toBe('U-12345');
    expect(body.events[0].event_properties).not.toHaveProperty('user_id');
  });

  it('extracts device_id from payload', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'login_success',
        user_id: 'U-12345',
        device_id: 'D-ABC',
        auth_method: 'google',
      },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].device_id).toBe('D-ABC');
    expect(body.events[0].event_properties).not.toHaveProperty('device_id');
  });

  it('extracts device_id from metadata when not in payload', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent({
      metadata: { device_id: 'D-META' },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].device_id).toBe('D-META');
  });

  it('extracts session_id as number', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'login_success',
        user_id: 'U-12345',
        session_id: 1700000000000,
        auth_method: 'google',
      },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].session_id).toBe(1700000000000);
    expect(body.events[0].event_properties).not.toHaveProperty('session_id');
  });

  it('converts session_id string to number', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'login_success',
        user_id: 'U-12345',
        session_id: '1700000000000',
        auth_method: 'google',
      },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].session_id).toBe(1700000000000);
  });

  it('extracts app_version from payload', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].app_version).toBe('2.1.0');
    expect(body.events[0].event_properties).not.toHaveProperty('app_version');
  });

  it('uses custom field names for extraction', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      userIdField: 'uid',
      sessionIdField: 'sid',
    });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'test',
        uid: 'U-999',
        sid: 12345,
        other: 'value',
      },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].user_id).toBe('U-999');
    expect(body.events[0].session_id).toBe(12345);
    expect(body.events[0].event_properties).not.toHaveProperty('uid');
    expect(body.events[0].event_properties).not.toHaveProperty('sid');
  });

  it('disables user_id extraction with null', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      userIdField: null,
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].user_id).toBeUndefined();
    expect(body.events[0].event_properties).toHaveProperty('user_id', 'U-12345');
  });

  it('puts remaining payload fields in event_properties', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].event_properties).toEqual({
      auth_method: 'google',
    });
  });

  it('excludes specified fields from event_properties', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      excludeFields: ['auth_method'],
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].event_properties).toBeUndefined();
  });

  it('excludes event_name from event_properties', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].event_properties).not.toHaveProperty('event_name');
  });

  it('skips null and undefined values in event_properties', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'test',
        user_id: 'U-12345',
        nullable_field: null,
        undef_field: undefined,
        valid_field: 'ok',
      },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].event_properties).not.toHaveProperty('nullable_field');
    expect(body.events[0].event_properties).not.toHaveProperty('undef_field');
    expect(body.events[0].event_properties).toHaveProperty('valid_field', 'ok');
  });

  it('extracts topLevelFieldMap fields', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      topLevelFieldMap: { platform_name: 'platform' },
    });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'test',
        user_id: 'U-12345',
        platform_name: 'web',
        other: 'value',
      },
    }));

    const body = parseFetchBody(calls);
    expect(body.events[0].platform).toBe('web');
    expect(body.events[0].event_properties).not.toHaveProperty('platform_name');
    expect(body.events[0].event_properties).toHaveProperty('other', 'value');
  });
});

// ─── HTTP Mode — Request Structure ───

describe('amplitude adapter — http mode — request structure', () => {
  it('sends to default US endpoint', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    expect(calls[0].url).toBe('https://api2.amplitude.com/2/httpapi');
  });

  it('sends to custom endpoint', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      endpoint: 'https://api.eu.amplitude.com/2/httpapi',
    });

    await adapter.send(makeEvent());

    expect(calls[0].url).toBe('https://api.eu.amplitude.com/2/httpapi');
  });

  it('sets timestamp from event.timestamp', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].time).toBe(1700000000000);
  });

  it('generates insert_id by default', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].insert_id).toBeDefined();
    expect(typeof body.events[0].insert_id).toBe('string');
    expect(body.events[0].insert_id.length).toBeGreaterThan(0);
  });

  it('disables insert_id when configured', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn, insertId: false });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].insert_id).toBeUndefined();
  });

  it('uses custom insert_id generator', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      insertId: () => 'custom-dedup-id',
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].insert_id).toBe('custom-dedup-id');
  });

  it('attaches static user_properties', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      userProperties: { plan: 'premium' },
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].user_properties).toEqual({ plan: 'premium' });
  });

  it('attaches static groups', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      groups: { org_id: 'ORG-1' },
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].groups).toEqual({ org_id: 'ORG-1' });
  });

  it('attaches plan metadata', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      plan: { branch: 'main', source: 'opentp' },
    });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.events[0].plan).toEqual({ branch: 'main', source: 'opentp' });
  });

  it('includes options.min_id_length when configured', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn, minIdLength: 3 });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.options).toEqual({ min_id_length: 3 });
  });

  it('omits options when minIdLength not set', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    const body = parseFetchBody(calls);
    expect(body.options).toBeUndefined();
  });

  it('sets keepalive on fetch by default', async () => {
    const { fn } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    expect(fn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('respects keepalive: false config', async () => {
    const { fn } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn, keepalive: false });

    await adapter.send(makeEvent());

    expect(fn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ keepalive: false }),
    );
  });

  it('sets Content-Type header', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

// ─── HTTP Mode — Batching ───

describe('amplitude adapter — http mode — batching', () => {
  it('sendBatch sends all events in single request', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.sendBatch!([makeEvent(), makeEvent()]);

    expect(calls).toHaveLength(1);
    const body = parseFetchBody(calls);
    expect(body.events).toHaveLength(2);
  });

  it('sendBatch chunks at maxBatchSize', async () => {
    const { fn, calls } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn, maxBatchSize: 2 });

    const events = [makeEvent(), makeEvent(), makeEvent(), makeEvent(), makeEvent()];
    await adapter.sendBatch!(events);

    expect(calls).toHaveLength(3); // 2 + 2 + 1

    expect(parseFetchBody(calls, 0).events).toHaveLength(2);
    expect(parseFetchBody(calls, 1).events).toHaveLength(2);
    expect(parseFetchBody(calls, 2).events).toHaveLength(1);
  });

  it('sendBatch sends chunks sequentially', async () => {
    const order: number[] = [];
    let callIndex = 0;
    const fn = vi.fn(async () => {
      const idx = callIndex++;
      // Add a small delay to catch parallelism
      await new Promise((r) => setTimeout(r, 10));
      order.push(idx);
      return new Response(JSON.stringify({ code: 200 }), { status: 200 });
    }) as any;

    const adapter = amplitude({ apiKey: 'test-key', fetch: fn, maxBatchSize: 1 });

    await adapter.sendBatch!([makeEvent(), makeEvent(), makeEvent()]);

    expect(order).toEqual([0, 1, 2]); // sequential, not interleaved
  });
});

// ─── Browser SDK Mode ───

describe('amplitude adapter — browser-sdk mode', () => {
  it('sends event via amplitude.track()', () => {
    const trackCalls: Array<{ eventType: string; props?: Record<string, unknown> }> = [];
    const mockAmp = {
      track: (eventType: string, props?: Record<string, unknown>) => {
        trackCalls.push({ eventType, props });
      },
    };

    const adapter = amplitude({
      apiKey: 'test-key',
      mode: 'browser-sdk',
      amplitudeInstance: mockAmp,
    });

    adapter.send(makeEvent());

    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0].eventType).toBe('login_success');
    expect(trackCalls[0].props).toEqual({ auth_method: 'google' });
  });

  it('excludes extracted fields from event_properties in browser mode', () => {
    const trackCalls: Array<{ eventType: string; props?: Record<string, unknown> }> = [];
    const mockAmp = {
      track: (eventType: string, props?: Record<string, unknown>) => {
        trackCalls.push({ eventType, props });
      },
    };

    const adapter = amplitude({
      apiKey: 'test-key',
      mode: 'browser-sdk',
      amplitudeInstance: mockAmp,
    });

    adapter.send(makeEvent());

    expect(trackCalls[0].props).not.toHaveProperty('user_id');
    expect(trackCalls[0].props).not.toHaveProperty('app_version');
    expect(trackCalls[0].props).not.toHaveProperty('event_name');
  });

  it('passes undefined props when all fields excluded', () => {
    const trackCalls: Array<{ eventType: string; props?: Record<string, unknown> }> = [];
    const mockAmp = {
      track: (eventType: string, props?: Record<string, unknown>) => {
        trackCalls.push({ eventType, props });
      },
    };

    const adapter = amplitude({
      apiKey: 'test-key',
      mode: 'browser-sdk',
      amplitudeInstance: mockAmp,
      excludeFields: ['auth_method'],
    });

    adapter.send(makeEvent());

    expect(trackCalls[0].props).toBeUndefined();
  });

  it('warns when Amplitude SDK not found', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = amplitude({
      apiKey: 'test-key',
      mode: 'browser-sdk',
    });

    adapter.send(makeEvent());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[opentp/amplitude] Amplitude SDK not found'),
    );
    warnSpy.mockRestore();
  });

  it('warns on init when SDK not found', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = amplitude({
      apiKey: 'test-key',
      mode: 'browser-sdk',
    });

    adapter.init?.();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[opentp/amplitude] Amplitude SDK not found on init'),
    );
    warnSpy.mockRestore();
  });

  it('sends batch events individually in browser-sdk mode', () => {
    const trackCalls: unknown[] = [];
    const mockAmp = {
      track: (...args: unknown[]) => trackCalls.push(args),
    };

    const adapter = amplitude({
      apiKey: 'test-key',
      mode: 'browser-sdk',
      amplitudeInstance: mockAmp,
    });

    adapter.sendBatch!([makeEvent(), makeEvent(), makeEvent()]);

    expect(trackCalls).toHaveLength(3);
  });
});

// ─── Error Handling ───

describe('amplitude adapter — error handling', () => {
  it('throws when fetch not available', async () => {
    const originalFetch = globalThis.fetch;
    delete (globalThis as any).fetch;

    const adapter = amplitude({ apiKey: 'test-key' });

    await expect(adapter.send(makeEvent())).rejects.toThrow(
      '[opentp/amplitude] fetch() not available',
    );

    globalThis.fetch = originalFetch;
  });

  it('calls onSendError on API error', async () => {
    const { fn } = mockFetch(400);
    const errors: Array<{ status: number; body: unknown }> = [];
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      onSendError: (err) => errors.push(err),
    });

    await adapter.send(makeEvent());

    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(400);
  });

  it('uses console.warn for errors when no onSendError', async () => {
    const { fn } = mockFetch(429);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.send(makeEvent());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[opentp/amplitude] API error 429'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('does not throw on API errors (resilient)', async () => {
    const { fn } = mockFetch(500);
    const adapter = amplitude({
      apiKey: 'test-key',
      fetch: fn,
      onSendError: () => {}, // swallow
    });

    // Should resolve, not reject
    await expect(adapter.send(makeEvent())).resolves.toBeUndefined();
  });
});

// ─── General ───

describe('amplitude adapter — general', () => {
  it('has correct adapter name', () => {
    const { fn } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    expect(adapter.name).toBe('amplitude');
  });

  it('destroy resolves cleanly', async () => {
    const { fn } = mockFetch();
    const adapter = amplitude({ apiKey: 'test-key', fetch: fn });

    await adapter.destroy?.();
  });
});
