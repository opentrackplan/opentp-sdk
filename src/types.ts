// ─── Event Types (matches generated SDK output) ───

/** Matches the TrackingEvent type from the generated SDK */
export interface TrackingEvent<TParams = void> {
  key: string;
  constants: Record<string, string | number | boolean>;
  buildPayload: TParams extends void
    ? () => Record<string, unknown>
    : (params: TParams) => Record<string, unknown>;
}

/** The events object from generated SDK — nested by area.eventName */
export type EventsMap = Record<string, Record<string, TrackingEvent<any>>>;

// ─── Adapter Types ───

/** Resolved event ready to be sent to an adapter */
export interface DispatchedEvent {
  /** Event key, e.g. "auth::login" */
  key: string;
  /** Area name, e.g. "auth" */
  area: string;
  /** Event name, e.g. "login" */
  eventName: string;
  /** Full merged payload (constants + params) */
  payload: Record<string, unknown>;
  /** Timestamp when the event was dispatched */
  timestamp: number;
  /** Metadata added by middleware */
  metadata: Record<string, unknown>;
}

/** An adapter sends events to a specific analytics platform */
export interface Adapter {
  /** Unique name for this adapter (e.g. "ga4", "snowplow") */
  name: string;
  /** Initialize the adapter (called once on tracker creation) */
  init?(): void | Promise<void>;
  /** Send a single event */
  send(event: DispatchedEvent): void | Promise<void>;
  /** Send a batch of events (optional — if not provided, send() is called for each) */
  sendBatch?(events: DispatchedEvent[]): void | Promise<void>;
  /** Cleanup (called on tracker.destroy()) */
  destroy?(): void | Promise<void>;
}

/** Factory function that creates an adapter with configuration */
export type AdapterFactory<TConfig = void> = TConfig extends void
  ? () => Adapter
  : (config: TConfig) => Adapter;

// ─── Middleware Types ───

/** Middleware can transform or filter events before they reach adapters */
export type Middleware = (event: DispatchedEvent, next: (event: DispatchedEvent) => void) => void;

// ─── Consent Types ───

/** Consent categories */
export type ConsentCategory = 'analytics' | 'marketing' | 'functional' | 'necessary';

export interface ConsentState {
  [category: string]: boolean;
}

export interface ConsentConfig {
  /** Initial consent state. Default: all denied except 'necessary' */
  defaultState?: ConsentState;
  /** Which consent category is required for an event (by area or key pattern) */
  mapping?: Record<string, ConsentCategory>;
  /** Default category when no mapping matches */
  defaultCategory?: ConsentCategory;
}

// ─── Tracker Config ───

export interface TrackerConfig<TEvents extends EventsMap = EventsMap> {
  /** Generated events object from opentp-cli */
  events: TEvents;
  /** Analytics adapters to send events to */
  adapters: Adapter[];
  /** Middleware chain (optional) */
  middleware?: Middleware[];
  /** Consent configuration (optional) */
  consent?: ConsentConfig;
  /** Queue/batching config (optional) */
  queue?: QueueConfig;
  /** Global metadata added to every event (optional) */
  globalMetadata?: Record<string, unknown>;
  /** Called on errors (optional, defaults to console.error) */
  onError?: (error: Error, event?: DispatchedEvent) => void;
}

export interface QueueConfig {
  /** Enable batching. Default: false */
  enabled?: boolean;
  /** Max events in batch before auto-flush. Default: 10 */
  maxSize?: number;
  /** Max time in ms before auto-flush. Default: 5000 */
  flushInterval?: number;
}

// ─── Tracker Type (returned by createTracker) ───

/**
 * Maps the events object to callable methods.
 * events.auth.login → tracker.auth.login({ auth_method: 'google' })
 */
export type TrackerMethods<TEvents extends EventsMap> = {
  [Area in keyof TEvents]: {
    [Event in keyof TEvents[Area]]: TEvents[Area][Event] extends TrackingEvent<infer P>
      ? P extends void
        ? () => void
        : (params: P) => void
      : never;
  };
};

export interface TrackerControls {
  /** Update consent state */
  setConsent(state: Partial<ConsentState>): void;
  /** Get current consent state */
  getConsent(): ConsentState;
  /** Flush queued events immediately */
  flush(): Promise<void>;
  /** Destroy tracker (flush + cleanup adapters) */
  destroy(): Promise<void>;
  /** Add metadata to all future events */
  setGlobalMetadata(metadata: Record<string, unknown>): void;
}

export type Tracker<TEvents extends EventsMap> = TrackerMethods<TEvents> & TrackerControls;
