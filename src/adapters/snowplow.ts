// src/adapters/snowplow.ts

import type { Adapter, DispatchedEvent } from '../types';

export interface SnowplowConfig {
  /**
   * Mode of operation.
   * - 'browser-tracker': uses @snowplow/browser-tracker (must be loaded separately)
   * - 'http': sends JSON POST to collector endpoint
   */
  mode: 'browser-tracker' | 'http';

  /**
   * Iglu schema vendor (e.g. "com.mycompany").
   * Used to build schema URIs: iglu:{vendor}/{event_name}/jsonschema/{version}
   */
  vendor: string;

  /**
   * Default schema version. Default: "1-0-0"
   * Can be overridden per event via schemaVersionMap.
   */
  defaultSchemaVersion?: string;

  /**
   * Map event keys to specific schema versions.
   * Example: { 'ecommerce::purchase': '2-0-0' }
   */
  schemaVersionMap?: Record<string, string>;

  /**
   * Fields to extract as Snowplow contexts (entities).
   * Key: context schema name, Value: field names to include.
   * Example: { 'user': ['user_id', 'user_email'] }
   * → Creates context: iglu:{vendor}/user/jsonschema/1-0-0 with { user_id, user_email }
   */
  contexts?: Record<
    string,
    {
      fields: string[];
      version?: string;
    }
  >;

  /**
   * Fields to exclude from the main event payload.
   * (Typically internal fields like schema_vendor, event_name, etc.)
   */
  excludeFields?: string[];

  /**
   * Resolve the schema name from a dispatched event.
   * Default: uses event_name from payload, or area_eventName.
   */
  resolveSchemaName?: (event: DispatchedEvent) => string;

  // ─── Browser Tracker mode options ───

  /**
   * Snowplow tracker namespace(s) to use.
   * Default: uses default tracker.
   */
  trackerNames?: string[];

  /**
   * Reference to trackSelfDescribingEvent function.
   * If not provided, tries to import from @snowplow/browser-tracker on window.
   */
  trackSelfDescribingEvent?: (args: {
    event: { schema: string; data: Record<string, unknown> };
    context?: Array<{ schema: string; data: Record<string, unknown> }>;
  }) => void;

  // ─── HTTP mode options ───

  /**
   * Collector endpoint URL (required for http mode).
   * Example: "https://collector.mysite.com"
   */
  collectorUrl?: string;

  /**
   * Custom fetch function (optional, defaults to global fetch).
   */
  fetch?: typeof fetch;

  /**
   * App ID sent with HTTP requests.
   */
  appId?: string;
}

// ─── Iglu Schema URI builder ───

function buildSchemaUri(vendor: string, name: string, version: string): string {
  return `iglu:${vendor}/${name}/jsonschema/${version}`;
}

// ─── Adapter Factory ───

export function snowplow(config: SnowplowConfig): Adapter {
  const {
    mode,
    vendor,
    defaultSchemaVersion = '1-0-0',
    schemaVersionMap = {},
    contexts: contextDefs = {},
    excludeFields = ['event_name', 'schema_vendor', 'schema_version'],
    resolveSchemaName,
    collectorUrl,
    appId,
  } = config;

  const excludeSet = new Set(excludeFields);
  // Also collect all fields used in contexts so they're excluded from main data
  const contextFieldSet = new Set<string>();
  for (const ctx of Object.values(contextDefs)) {
    for (const f of ctx.fields) contextFieldSet.add(f);
  }

  let trackFn = config.trackSelfDescribingEvent ?? null;
  const fetchFn =
    config.fetch ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  /** Get the schema name for an event */
  function getSchemaName(event: DispatchedEvent): string {
    if (resolveSchemaName) return resolveSchemaName(event);
    // Use event_name from payload if available
    if (typeof event.payload.event_name === 'string') return event.payload.event_name;
    // Fallback: area_eventName
    return `${event.area}_${event.eventName}`;
  }

  /** Get the schema version for an event */
  function getSchemaVersion(event: DispatchedEvent): string {
    // Check explicit map first (takes precedence)
    if (schemaVersionMap[event.key]) return schemaVersionMap[event.key];
    // Check payload for schema_version field
    if (typeof event.payload.schema_version === 'string') return event.payload.schema_version;
    return defaultSchemaVersion;
  }

  /** Build the main event data (excluding contexts and meta fields) */
  function buildEventData(event: DispatchedEvent): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.payload)) {
      if (excludeSet.has(key)) continue;
      if (contextFieldSet.has(key)) continue;
      if (value === undefined || value === null) continue;
      data[key] = value;
    }
    return data;
  }

  /** Build context entities from event payload */
  function buildContexts(
    event: DispatchedEvent,
  ): Array<{ schema: string; data: Record<string, unknown> }> {
    const contexts: Array<{ schema: string; data: Record<string, unknown> }> = [];

    for (const [contextName, contextDef] of Object.entries(contextDefs)) {
      const data: Record<string, unknown> = {};
      let hasData = false;

      for (const field of contextDef.fields) {
        if (event.payload[field] !== undefined && event.payload[field] !== null) {
          data[field] = event.payload[field];
          hasData = true;
        }
      }

      if (hasData) {
        contexts.push({
          schema: buildSchemaUri(vendor, contextName, contextDef.version ?? defaultSchemaVersion),
          data,
        });
      }
    }

    return contexts;
  }

  // ─── Browser Tracker Send ───

  function sendViaBrowserTracker(event: DispatchedEvent): void {
    const fn = trackFn ?? getWindowTracker();
    if (!fn) {
      console.warn(
        '[opentp/snowplow] trackSelfDescribingEvent not found. Is @snowplow/browser-tracker loaded?',
      );
      return;
    }

    const schemaName = getSchemaName(event);
    const version = getSchemaVersion(event);
    const data = buildEventData(event);
    const contexts = buildContexts(event);

    fn({
      event: {
        schema: buildSchemaUri(vendor, schemaName, version),
        data,
      },
      context: contexts.length > 0 ? contexts : undefined,
    });
  }

  function getWindowTracker() {
    if (typeof window !== 'undefined' && (window as any).snowplow_trackSelfDescribingEvent) {
      return (window as any).snowplow_trackSelfDescribingEvent;
    }
    return null;
  }

  // ─── HTTP Send ───

  async function sendViaHttp(event: DispatchedEvent): Promise<void> {
    if (!collectorUrl) {
      throw new Error('[opentp/snowplow] collectorUrl is required for http mode');
    }
    if (!fetchFn) {
      throw new Error('[opentp/snowplow] fetch() not available');
    }

    const schemaName = getSchemaName(event);
    const version = getSchemaVersion(event);
    const data = buildEventData(event);
    const contexts = buildContexts(event);

    const selfDescribingEvent = {
      schema: buildSchemaUri(vendor, schemaName, version),
      data,
    };

    const payload: Record<string, unknown> = {
      schema: 'iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4',
      data: [
        {
          e: 'ue', // unstructured event
          ue_pr: JSON.stringify({
            schema: 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0',
            data: selfDescribingEvent,
          }),
          co:
            contexts.length > 0
              ? JSON.stringify({
                  schema: 'iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-1',
                  data: contexts,
                })
              : undefined,
          dtm: String(event.timestamp),
          aid: appId,
          p: 'web',
        },
      ],
    };

    await fetchFn(`${collectorUrl}/com.snowplowanalytics.snowplow/tp2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }

  // ─── HTTP Batch Send ───

  async function sendBatchViaHttp(events: DispatchedEvent[]): Promise<void> {
    if (!collectorUrl || !fetchFn) return;

    const dataItems = events.map((event) => {
      const schemaName = getSchemaName(event);
      const version = getSchemaVersion(event);
      const data = buildEventData(event);
      const contexts = buildContexts(event);

      const selfDescribingEvent = {
        schema: buildSchemaUri(vendor, schemaName, version),
        data,
      };

      return {
        e: 'ue',
        ue_pr: JSON.stringify({
          schema: 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0',
          data: selfDescribingEvent,
        }),
        co:
          contexts.length > 0
            ? JSON.stringify({
                schema: 'iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-1',
                data: contexts,
              })
            : undefined,
        dtm: String(event.timestamp),
        aid: appId,
        p: 'web',
      };
    });

    await fetchFn(`${collectorUrl}/com.snowplowanalytics.snowplow/tp2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: 'iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4',
        data: dataItems,
      }),
      keepalive: true,
    });
  }

  // ─── Adapter ───

  return {
    name: 'snowplow',

    send(event: DispatchedEvent) {
      if (mode === 'browser-tracker') {
        sendViaBrowserTracker(event);
        return;
      } else {
        return sendViaHttp(event);
      }
    },

    sendBatch(events: DispatchedEvent[]) {
      if (mode === 'http') {
        return sendBatchViaHttp(events);
      }
      // Browser tracker doesn't support batch — send individually
      for (const event of events) {
        sendViaBrowserTracker(event);
      }
      return;
    },

    destroy() {
      trackFn = null;
    },
  };
}
