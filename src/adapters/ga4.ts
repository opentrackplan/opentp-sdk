// src/adapters/ga4.ts

import type { Adapter, DispatchedEvent } from '../types';

export interface GA4Config {
  /** GA4 Measurement ID (e.g. "G-XXXXXXX") */
  measurementId: string;

  /**
   * Map event keys to GA4 event names.
   * By default, uses the `event_name` field from the payload.
   * Override specific events: { 'auth::login': 'login', 'ecommerce::purchase': 'purchase' }
   */
  eventNameMap?: Record<string, string>;

  /**
   * Map OpenTrackPlan field names to GA4 parameter names.
   * Example: { 'auth_method': 'method', 'product_price': 'value' }
   */
  parameterMap?: Record<string, string>;

  /**
   * Fields to exclude from GA4 payload.
   * Useful for removing internal fields that GA4 doesn't need.
   * Example: ['schema_vendor', 'schema_version']
   */
  excludeFields?: string[];

  /**
   * If true, also push events to dataLayer (for GTM).
   * Default: false
   */
  pushToDataLayer?: boolean;

  /**
   * Custom gtag function reference.
   * Default: window.gtag
   */
  gtag?: (...args: unknown[]) => void;

  /**
   * If true, send events even if gtag is not loaded.
   * Events will be queued in dataLayer for when gtag loads.
   * Default: true
   */
  tolerateMissingGtag?: boolean;

  /**
   * GA4 user properties to set on init.
   * Example: { user_type: 'premium' }
   */
  userProperties?: Record<string, string | number | boolean>;

  /**
   * If true, log a warning when gtag is not found.
   * Default: true
   */
  warnIfMissing?: boolean;
}

// GA4 reserved parameter names that should not be overwritten
const GA4_RESERVED_PARAMS = new Set([
  'firebase_screen',
  'firebase_screen_class',
  'firebase_event_origin',
  'firebase_previous_class',
  'firebase_previous_id',
  'firebase_previous_screen',
]);

export function ga4(config: GA4Config): Adapter {
  const {
    measurementId,
    eventNameMap = {},
    parameterMap = {},
    excludeFields = [],
    pushToDataLayer = false,
    tolerateMissingGtag = true,
    userProperties,
    warnIfMissing = true,
  } = config;

  let gtagFn = config.gtag ?? null;
  const excludeSet = new Set(excludeFields);

  function getGtag(): ((...args: unknown[]) => void) | null {
    if (gtagFn) return gtagFn;
    if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
      gtagFn = (window as any).gtag;
      return gtagFn;
    }
    return null;
  }

  function getDataLayer(): unknown[] | null {
    if (typeof window !== 'undefined') {
      (window as any).dataLayer = (window as any).dataLayer || [];
      return (window as any).dataLayer;
    }
    return null;
  }

  /** Resolve GA4 event name from dispatched event */
  function resolveEventName(event: DispatchedEvent): string {
    // 1. Explicit mapping by key
    if (eventNameMap[event.key]) return eventNameMap[event.key];
    // 2. From payload's event_name field
    if (typeof event.payload.event_name === 'string') return event.payload.event_name;
    // 3. Convert event key to GA4-friendly name: auth::login → auth_login
    return event.key.replace('::', '_');
  }

  /** Build GA4 parameters from event payload */
  function buildParameters(event: DispatchedEvent): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(event.payload)) {
      // Skip excluded fields
      if (excludeSet.has(key)) continue;
      // Skip event_name (it's the GA4 event name, not a parameter)
      if (key === 'event_name') continue;
      // Skip reserved GA4 params
      if (GA4_RESERVED_PARAMS.has(key)) continue;
      // Skip undefined/null
      if (value === undefined || value === null) continue;

      // Apply parameter name mapping
      const mappedKey = parameterMap[key] ?? key;
      params[mappedKey] = value;
    }

    // Add send_to for measurement ID specificity
    params.send_to = measurementId;

    return params;
  }

  return {
    name: 'ga4',

    init() {
      const gtag = getGtag();

      if (!gtag) {
        if (warnIfMissing) {
          console.warn(
            `[opentp/ga4] gtag() not found. Make sure the Google tag script is loaded.\n` +
              `Add to <head>: <script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>`,
          );
        }
        if (!tolerateMissingGtag) {
          throw new Error('[opentp/ga4] gtag() not found and tolerateMissingGtag is false');
        }
      }

      // Set user properties if provided
      if (gtag && userProperties) {
        gtag('set', 'user_properties', userProperties);
      }
    },

    send(event: DispatchedEvent) {
      const eventName = resolveEventName(event);
      const params = buildParameters(event);

      // Send via gtag
      const gtag = getGtag();
      if (gtag) {
        gtag('event', eventName, params);
      } else if (tolerateMissingGtag) {
        // Push to dataLayer for deferred processing
        const dataLayer = getDataLayer();
        if (dataLayer) {
          dataLayer.push({
            event: eventName,
            ...params,
          });
        }
      }

      // Also push to dataLayer if configured (for GTM)
      if (pushToDataLayer) {
        const dataLayer = getDataLayer();
        if (dataLayer) {
          dataLayer.push({
            event: eventName,
            opentp_key: event.key,
            ...params,
          });
        }
      }
    },

    destroy() {
      gtagFn = null;
    },
  };
}
