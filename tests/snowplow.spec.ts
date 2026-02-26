// tests/snowplow.spec.ts

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { snowplow } from '../src/adapters/snowplow';
import type { DispatchedEvent } from '../src/types';

function makeEvent(overrides: Partial<DispatchedEvent> = {}): DispatchedEvent {
  return {
    key: 'ecommerce::product_view',
    area: 'ecommerce',
    eventName: 'product_view',
    payload: {
      event_name: 'product_view',
      schema_version: '1-0-0',
      product_id: 'SKU-123',
      product_name: 'Widget',
      price: 29.99,
    },
    timestamp: 1700000000000,
    metadata: {},
    ...overrides,
  };
}

describe('snowplow adapter — browser-tracker mode', () => {
  it('sends self-describing event', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent());

    expect(trackCalls).toHaveLength(1);
    const call = trackCalls[0] as any;
    expect(call.event.schema).toBe('iglu:com.mycompany/product_view/jsonschema/1-0-0');
    expect(call.event.data).toEqual({
      product_id: 'SKU-123',
      product_name: 'Widget',
      price: 29.99,
    });
  });

  it('excludes meta fields from event data', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent());

    const data = (trackCalls[0] as any).event.data;
    expect(data).not.toHaveProperty('event_name');
    expect(data).not.toHaveProperty('schema_version');
  });

  it('uses schemaVersionMap override', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      schemaVersionMap: { 'ecommerce::product_view': '2-1-0' },
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent());

    expect((trackCalls[0] as any).event.schema).toContain('2-1-0');
  });

  it('extracts contexts from payload', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      contexts: {
        user: { fields: ['user_id', 'user_email'], version: '1-0-0' },
      },
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent({
      payload: {
        event_name: 'product_view',
        product_id: 'SKU-123',
        user_id: 'U-456',
        user_email: 'test@example.com',
      },
    }));

    const call = trackCalls[0] as any;
    // User fields extracted to context, not in main data
    expect(call.event.data).not.toHaveProperty('user_id');
    expect(call.event.data).not.toHaveProperty('user_email');
    // Context present
    expect(call.context).toHaveLength(1);
    expect(call.context[0].schema).toBe('iglu:com.mycompany/user/jsonschema/1-0-0');
    expect(call.context[0].data).toEqual({ user_id: 'U-456', user_email: 'test@example.com' });
  });

  it('uses custom resolveSchemaName', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      resolveSchemaName: (event) => `custom_${event.eventName}`,
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent());

    expect((trackCalls[0] as any).event.schema).toContain('custom_product_view');
  });

  it('falls back to area_eventName when event_name is missing', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent({
      payload: {
        product_id: 'SKU-123',
      },
    }));

    expect((trackCalls[0] as any).event.schema).toContain('ecommerce_product_view');
  });

  it('omits context field when no contexts present', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent());

    expect((trackCalls[0] as any).context).toBeUndefined();
  });

  it('skips context when no matching fields in payload', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      contexts: {
        user: { fields: ['user_id', 'user_email'] },
      },
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent({
      payload: {
        event_name: 'product_view',
        product_id: 'SKU-123',
      },
    }));

    expect((trackCalls[0] as any).context).toBeUndefined();
  });

  it('excludes custom fields', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      excludeFields: ['event_name', 'product_id'],
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.send(makeEvent());

    const data = (trackCalls[0] as any).event.data;
    expect(data).not.toHaveProperty('event_name');
    expect(data).not.toHaveProperty('product_id');
    expect(data).toHaveProperty('product_name');
  });

  it('sends batch events individually in browser-tracker mode', () => {
    const trackCalls: unknown[] = [];
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: (args) => trackCalls.push(args),
    });

    adapter.sendBatch?.([makeEvent(), makeEvent()]);

    expect(trackCalls).toHaveLength(2);
  });

  it('warns when trackSelfDescribingEvent not found', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
    });

    adapter.send(makeEvent());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[opentp/snowplow] trackSelfDescribingEvent not found')
    );

    warnSpy.mockRestore();
  });
});

describe('snowplow adapter — http mode', () => {
  it('sends POST to collector', async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];
    const mockFetch = vi.fn(async (url: string, init: any) => {
      fetchCalls.push({ url, body: init.body });
      return new Response('OK', { status: 200 });
    }) as any;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
      appId: 'my-app',
      fetch: mockFetch,
    });

    await adapter.send(makeEvent());

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://collector.test.com/com.snowplowanalytics.snowplow/tp2');

    const body = JSON.parse(fetchCalls[0].body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].e).toBe('ue');
    expect(body.data[0].aid).toBe('my-app');

    const uePayload = JSON.parse(body.data[0].ue_pr);
    expect(uePayload.data.schema).toContain('product_view');
  });

  it('sends batch in single request', async () => {
    const fetchCalls: Array<{ body: string }> = [];
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      fetchCalls.push({ body: init.body });
      return new Response('OK', { status: 200 });
    }) as any;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
      fetch: mockFetch,
    });

    await adapter.sendBatch!([makeEvent(), makeEvent()]);

    expect(fetchCalls).toHaveLength(1); // single request
    const body = JSON.parse(fetchCalls[0].body);
    expect(body.data).toHaveLength(2); // two events in batch
  });

  it('includes contexts in HTTP payload', async () => {
    const fetchCalls: Array<{ body: string }> = [];
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      fetchCalls.push({ body: init.body });
      return new Response('OK', { status: 200 });
    }) as any;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
      contexts: {
        user: { fields: ['user_id'] },
      },
      fetch: mockFetch,
    });

    await adapter.send(makeEvent({
      payload: {
        event_name: 'product_view',
        product_id: 'SKU-123',
        user_id: 'U-456',
      },
    }));

    const body = JSON.parse(fetchCalls[0].body);
    const co = JSON.parse(body.data[0].co);
    expect(co.data).toHaveLength(1);
    expect(co.data[0].schema).toContain('user');
    expect(co.data[0].data).toEqual({ user_id: 'U-456' });
  });

  it('omits co field when no contexts', async () => {
    const fetchCalls: Array<{ body: string }> = [];
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      fetchCalls.push({ body: init.body });
      return new Response('OK', { status: 200 });
    }) as any;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
      fetch: mockFetch,
    });

    await adapter.send(makeEvent());

    const body = JSON.parse(fetchCalls[0].body);
    expect(body.data[0].co).toBeUndefined();
  });

  it('includes timestamp in HTTP payload', async () => {
    const fetchCalls: Array<{ body: string }> = [];
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      fetchCalls.push({ body: init.body });
      return new Response('OK', { status: 200 });
    }) as any;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
      fetch: mockFetch,
    });

    await adapter.send(makeEvent());

    const body = JSON.parse(fetchCalls[0].body);
    expect(body.data[0].dtm).toBe('1700000000000');
  });

  it('throws error when collectorUrl is missing', async () => {
    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      fetch: vi.fn() as any,
    });

    await expect(adapter.send(makeEvent())).rejects.toThrow(
      '[opentp/snowplow] collectorUrl is required for http mode'
    );
  });

  it('throws error when fetch is not available', async () => {
    // Save the original fetch and remove it
    const originalFetch = globalThis.fetch;
    delete (globalThis as any).fetch;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
    });

    await expect(adapter.send(makeEvent())).rejects.toThrow(
      '[opentp/snowplow] fetch() not available'
    );

    // Restore fetch
    globalThis.fetch = originalFetch;
  });

  it('sets keepalive flag on fetch', async () => {
    const mockFetch = vi.fn(async () => new Response('OK', { status: 200 })) as any;

    const adapter = snowplow({
      mode: 'http',
      vendor: 'com.mycompany',
      collectorUrl: 'https://collector.test.com',
      fetch: mockFetch,
    });

    await adapter.send(makeEvent());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ keepalive: true })
    );
  });
});

describe('snowplow adapter — general', () => {
  it('has correct adapter name', () => {
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: vi.fn(),
    });

    expect(adapter.name).toBe('snowplow');
  });

  it('cleans up on destroy', () => {
    const trackFn = vi.fn();
    const adapter = snowplow({
      mode: 'browser-tracker',
      vendor: 'com.mycompany',
      trackSelfDescribingEvent: trackFn,
    });

    adapter.send(makeEvent());
    expect(trackFn).toHaveBeenCalled();

    adapter.destroy?.();
  });
});
