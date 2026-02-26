export { debugMiddleware } from './debug';
export { createTracker } from './tracker';

// Re-export all types
export type {
  Adapter,
  AdapterFactory,
  ConsentCategory,
  ConsentConfig,
  ConsentState,
  DispatchedEvent,
  EventsMap,
  Middleware,
  QueueConfig,
  Tracker,
  TrackerConfig,
  TrackerControls,
  TrackerMethods,
  TrackingEvent,
} from './types';
