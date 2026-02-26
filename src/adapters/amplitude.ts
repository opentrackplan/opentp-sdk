// src/adapters/amplitude.ts

import type { Adapter, DispatchedEvent } from '../types';

export interface AmplitudeConfig {
  /** Amplitude API key (required) */
  apiKey: string;

  /**
   * Mode of operation.
   * - 'http': sends JSON POST to Amplitude HTTP V2 API (works in browser + server)
   * - 'browser-sdk': uses Amplitude Browser SDK instance (amplitude.track())
   * Default: 'http'
   */
  mode?: 'http' | 'browser-sdk';

  // ─── HTTP mode options ───

  /**
   * API endpoint URL.
   * US (default): 'https://api2.amplitude.com/2/httpapi'
   * EU: 'https://api.eu.amplitude.com/2/httpapi'
   */
  endpoint?: string;

  /** Custom fetch function. Default: globalThis.fetch */
  fetch?: typeof fetch;

  /**
   * If true, use keepalive flag on fetch requests (for page unload reliability).
   * Default: true
   */
  keepalive?: boolean;

  /**
   * Maximum events per batch request (Amplitude limit: 2000).
   * Default: 2000
   */
  maxBatchSize?: number;

  // ─── Browser SDK mode options ───

  /**
   * Amplitude Browser SDK instance.
   * Must have .track(eventType, eventProperties) method.
   * Default: window.amplitude
   */
  amplitudeInstance?: AmplitudeLike;

  // ─── Event mapping ───

  /**
   * Map event keys to Amplitude event_type names.
   * By default, uses the `event_name` field from the payload.
   * Example: { 'auth::login': 'User Logged In' }
   */
  eventNameMap?: Record<string, string>;

  // ─── Field extraction (payload → top-level Amplitude fields) ───

  /**
   * Payload field name to extract as Amplitude user_id.
   * Default: 'user_id'. Set to null to disable extraction.
   */
  userIdField?: string | null;

  /**
   * Payload field name to extract as Amplitude device_id.
   * Also checked in event.metadata if not found in payload.
   * Default: 'device_id'. Set to null to disable extraction.
   */
  deviceIdField?: string | null;

  /**
   * Payload field name to extract as Amplitude session_id.
   * Value must be a number (ms since epoch) or numeric string.
   * Default: 'session_id'. Set to null to disable extraction.
   */
  sessionIdField?: string | null;

  /**
   * Payload field name to extract as Amplitude app_version.
   * Default: 'app_version'. Set to null to disable extraction.
   */
  appVersionField?: string | null;

  /**
   * Additional payload fields to extract as top-level Amplitude event fields.
   * Maps OpenTP field name → Amplitude top-level field name.
   * Supported: platform, os_name, os_version, device_brand,
   * device_manufacturer, device_model, country, region, city, language, ip
   */
  topLevelFieldMap?: Record<string, string>;

  /**
   * Fields to exclude from event_properties entirely.
   * Extracted fields (user_id, device_id, etc.) are always excluded automatically.
   */
  excludeFields?: string[];

  // ─── Static properties ───

  /** Static user_properties to send with every event. */
  userProperties?: Record<string, unknown>;

  /** Static groups to send with every event (Amplitude Accounts feature). */
  groups?: Record<string, unknown>;

  /**
   * Amplitude tracking plan metadata.
   * Example: { branch: 'main', source: 'opentp', version: '1.0.0' }
   */
  plan?: { branch?: string; source?: string; version?: string };

  // ─── Options ───

  /**
   * Minimum user_id / device_id length (Amplitude default: 5).
   * Sent as options.min_id_length in HTTP requests.
   */
  minIdLength?: number;

  /**
   * Generate insert_id for deduplication (7-day window).
   * Default: generates UUID via crypto.randomUUID() or fallback.
   * Set to false to disable. Provide a function for custom generation.
   */
  insertId?: false | (() => string);

  /**
   * Called when Amplitude API returns a non-OK response (HTTP mode only).
   * Default: console.warn
   */
  onSendError?: (error: { status: number; body: unknown }) => void;
}

/** Minimal interface for Amplitude Browser SDK */
export interface AmplitudeLike {
  track(eventType: string, eventProperties?: Record<string, unknown>): void;
  identify?(identify: unknown): void;
  setGroup?(groupType: string, groupName: string | string[]): void;
}

// ─── Constants ───

const DEFAULT_ENDPOINT = 'https://api2.amplitude.com/2/httpapi';
const DEFAULT_MAX_BATCH = 2000;

// Fields always excluded from event_properties (they become event_type)
const ALWAYS_EXCLUDED = new Set(['event_name']);

// ─── Helpers ───

function defaultInsertId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Adapter Factory ───

export function amplitude(config: AmplitudeConfig): Adapter {
  const {
    apiKey,
    mode = 'http',
    endpoint = DEFAULT_ENDPOINT,
    keepalive = true,
    maxBatchSize = DEFAULT_MAX_BATCH,
    eventNameMap = {},
    userIdField = 'user_id',
    deviceIdField = 'device_id',
    sessionIdField = 'session_id',
    appVersionField = 'app_version',
    topLevelFieldMap = {},
    excludeFields = [],
    userProperties,
    groups,
    plan,
    minIdLength,
    onSendError,
  } = config;

  const fetchFn =
    config.fetch ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const insertIdFn = config.insertId === false ? null : (config.insertId ?? defaultInsertId);

  // Build the set of fields to exclude from event_properties
  const excludeSet = new Set<string>([...ALWAYS_EXCLUDED, ...excludeFields]);
  if (userIdField) excludeSet.add(userIdField);
  if (deviceIdField) excludeSet.add(deviceIdField);
  if (sessionIdField) excludeSet.add(sessionIdField);
  if (appVersionField) excludeSet.add(appVersionField);
  for (const field of Object.keys(topLevelFieldMap)) {
    excludeSet.add(field);
  }

  let ampInstance = config.amplitudeInstance ?? null;

  // ─── Resolve event type ───

  function resolveEventType(event: DispatchedEvent): string {
    if (eventNameMap[event.key]) return eventNameMap[event.key];
    if (typeof event.payload.event_name === 'string') return event.payload.event_name;
    return event.key.replace('::', '_');
  }

  // ─── Extract a string field from payload or metadata ───

  function extractString(event: DispatchedEvent, field: string | null): string | undefined {
    if (!field) return undefined;
    const val = event.payload[field] ?? event.metadata[field];
    return typeof val === 'string' ? val : undefined;
  }

  // ─── Extract session_id as number ───

  function extractSessionId(event: DispatchedEvent): number | undefined {
    if (!sessionIdField) return undefined;
    const val = event.payload[sessionIdField] ?? event.metadata[sessionIdField];
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const num = Number(val);
      if (!Number.isNaN(num)) return num;
    }
    return undefined;
  }

  // ─── Build Amplitude event object ───

  interface AmplitudeEvent {
    event_type: string;
    user_id?: string;
    device_id?: string;
    time?: number;
    session_id?: number;
    app_version?: string;
    insert_id?: string;
    event_properties?: Record<string, unknown>;
    user_properties?: Record<string, unknown>;
    groups?: Record<string, unknown>;
    plan?: { branch?: string; source?: string; version?: string };
    [key: string]: unknown;
  }

  function buildAmplitudeEvent(event: DispatchedEvent): AmplitudeEvent {
    const ampEvent: AmplitudeEvent = {
      event_type: resolveEventType(event),
    };

    // Extract top-level identity fields
    const userId = extractString(event, userIdField);
    if (userId) ampEvent.user_id = userId;

    const deviceId = extractString(event, deviceIdField);
    if (deviceId) ampEvent.device_id = deviceId;

    const sessionId = extractSessionId(event);
    if (sessionId !== undefined) ampEvent.session_id = sessionId;

    const appVersion = appVersionField ? extractString(event, appVersionField) : undefined;
    if (appVersion) ampEvent.app_version = appVersion;

    // Timestamp
    ampEvent.time = event.timestamp;

    // Deduplication ID
    if (insertIdFn) {
      ampEvent.insert_id = insertIdFn();
    }

    // Extract additional top-level fields
    for (const [sourceField, targetField] of Object.entries(topLevelFieldMap)) {
      const val = event.payload[sourceField];
      if (val !== undefined && val !== null) {
        ampEvent[targetField] = val;
      }
    }

    // Build event_properties from remaining payload fields
    const eventProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.payload)) {
      if (excludeSet.has(key)) continue;
      if (value === undefined || value === null) continue;
      eventProperties[key] = value;
    }
    if (Object.keys(eventProperties).length > 0) {
      ampEvent.event_properties = eventProperties;
    }

    // Static properties
    if (userProperties) ampEvent.user_properties = userProperties;
    if (groups) ampEvent.groups = groups;
    if (plan) ampEvent.plan = plan;

    return ampEvent;
  }

  // ─── HTTP mode: send request ───

  async function sendHttpRequest(events: AmplitudeEvent[]): Promise<void> {
    if (!fetchFn) {
      throw new Error('[opentp/amplitude] fetch() not available');
    }

    const body: Record<string, unknown> = {
      api_key: apiKey,
      events,
    };

    if (minIdLength !== undefined) {
      body.options = { min_id_length: minIdLength };
    }

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      const handler =
        onSendError ??
        ((err: { status: number; body: unknown }) => {
          console.warn(`[opentp/amplitude] API error ${err.status}:`, err.body);
        });
      handler({ status: response.status, body: errorBody });
    }
  }

  // ─── Browser SDK mode: get instance ───

  function getAmplitude(): AmplitudeLike | null {
    if (ampInstance) return ampInstance;
    if (typeof window !== 'undefined' && (window as any).amplitude) {
      ampInstance = (window as any).amplitude;
      return ampInstance;
    }
    return null;
  }

  // ─── Browser SDK mode: send ───

  function sendViaBrowserSdk(event: DispatchedEvent): void {
    const amp = getAmplitude();
    if (!amp) {
      console.warn(
        '[opentp/amplitude] Amplitude SDK not found. Is the Amplitude Browser SDK loaded?',
      );
      return;
    }

    const eventType = resolveEventType(event);

    // Build event_properties (same filtering as HTTP mode)
    const eventProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.payload)) {
      if (excludeSet.has(key)) continue;
      if (value === undefined || value === null) continue;
      eventProperties[key] = value;
    }

    amp.track(eventType, Object.keys(eventProperties).length > 0 ? eventProperties : undefined);
  }

  // ─── Adapter ───

  return {
    name: 'amplitude',

    init() {
      if (mode === 'browser-sdk') {
        const amp = getAmplitude();
        if (!amp) {
          console.warn(
            '[opentp/amplitude] Amplitude SDK not found on init. Is the Amplitude Browser SDK loaded?',
          );
        }
      }
    },

    send(event: DispatchedEvent) {
      if (mode === 'browser-sdk') {
        sendViaBrowserSdk(event);
        return;
      }
      return sendHttpRequest([buildAmplitudeEvent(event)]);
    },

    sendBatch(events: DispatchedEvent[]) {
      if (mode === 'browser-sdk') {
        // Browser SDK doesn't support batch — send individually
        for (const event of events) {
          sendViaBrowserSdk(event);
        }
        return;
      }

      // HTTP mode: chunk at maxBatchSize and send sequentially
      const chunks: AmplitudeEvent[][] = [];
      let current: AmplitudeEvent[] = [];

      for (const event of events) {
        current.push(buildAmplitudeEvent(event));
        if (current.length >= maxBatchSize) {
          chunks.push(current);
          current = [];
        }
      }
      if (current.length > 0) chunks.push(current);

      return chunks.reduce<Promise<void>>(
        (promise, chunk) => promise.then(() => sendHttpRequest(chunk)),
        Promise.resolve(),
      );
    },

    destroy() {
      ampInstance = null;
    },
  };
}
