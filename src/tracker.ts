import { ConsentManager } from './consent';
import { Dispatcher } from './dispatcher';
import { EventQueue } from './queue';
import type {
  ConsentState,
  DispatchedEvent,
  EventsMap,
  Tracker,
  TrackerConfig,
  TrackerMethods,
  TrackingEvent,
} from './types';

export function createTracker<TEvents extends EventsMap>(
  config: TrackerConfig<TEvents>,
): Tracker<TEvents> {
  const {
    events,
    adapters,
    middleware = [],
    consent: consentConfig,
    queue: queueConfig,
    onError = (err) => console.error('[opentp]', err),
  } = config;

  let globalMetadata: Record<string, unknown> = { ...config.globalMetadata };

  // Initialize subsystems
  const consentManager = new ConsentManager(consentConfig);
  const dispatcher = new Dispatcher(adapters, middleware);

  const queue = queueConfig?.enabled
    ? new EventQueue(queueConfig, (batch) => dispatcher.dispatchBatch(batch))
    : null;

  // Initialize adapters
  for (const adapter of adapters) {
    try {
      adapter.init?.();
    } catch (err) {
      onError(new Error(`Failed to init adapter "${adapter.name}": ${(err as Error).message}`));
    }
  }

  // Build the dispatch function
  function dispatchEvent(
    key: string,
    area: string,
    eventName: string,
    payload: Record<string, unknown>,
  ): void {
    const event: DispatchedEvent = {
      key,
      area,
      eventName,
      payload,
      timestamp: Date.now(),
      metadata: { ...globalMetadata },
    };

    // Check consent
    if (!consentManager.isAllowed(event)) {
      return; // silently drop — user hasn't consented
    }

    if (queue) {
      queue.push(event);
    } else {
      dispatcher.dispatch(event).catch((err) => onError(err as Error, event));
    }
  }

  // Build proxy-based tracker methods
  // tracker.auth.login({ ... }) → dispatchEvent('auth::login', 'auth', 'login', payload)
  const methodsProxy = new Proxy({} as TrackerMethods<TEvents>, {
    get(_target, areaProp: string) {
      const areaEvents = events[areaProp];
      if (!areaEvents) return undefined;

      return new Proxy(
        {},
        {
          get(_t, eventProp: string) {
            const eventDef = areaEvents[eventProp] as TrackingEvent<any> | undefined;
            if (!eventDef) return undefined;

            return (params?: unknown) => {
              try {
                const payload =
                  params !== undefined
                    ? eventDef.buildPayload(params)
                    : (eventDef.buildPayload as () => Record<string, unknown>)();
                dispatchEvent(eventDef.key, areaProp, eventProp, payload);
              } catch (err) {
                onError(err as Error);
              }
            };
          },
        },
      );
    },
  });

  // Control methods
  const controls = {
    setConsent(state: Partial<ConsentState>) {
      consentManager.update(state);
    },

    getConsent(): ConsentState {
      return consentManager.getState();
    },

    async flush(): Promise<void> {
      if (queue) await queue.flush();
    },

    async destroy(): Promise<void> {
      if (queue) await queue.destroy();
      for (const adapter of adapters) {
        try {
          await adapter.destroy?.();
        } catch (err) {
          onError(
            new Error(`Failed to destroy adapter "${adapter.name}": ${(err as Error).message}`),
          );
        }
      }
    },

    setGlobalMetadata(metadata: Record<string, unknown>) {
      globalMetadata = { ...globalMetadata, ...metadata };
    },
  };

  // Combine methods proxy + controls into one object
  return new Proxy(controls as Tracker<TEvents>, {
    get(target, prop: string) {
      // Control methods take priority
      if (prop in target) return (target as any)[prop];
      // Otherwise proxy to event methods
      return (methodsProxy as any)[prop];
    },
  });
}
