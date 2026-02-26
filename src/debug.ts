import type { DispatchedEvent, Middleware } from './types';

export interface DebugOptions {
  /** Custom logger. Default: console.log */
  logger?: (message: string, event: DispatchedEvent) => void;
  /** Only log events matching these areas */
  areas?: string[];
  /** Include full payload in logs. Default: true */
  showPayload?: boolean;
}

export function debugMiddleware(options?: DebugOptions): Middleware {
  const logger =
    options?.logger ??
    ((msg, event) => {
      console.log(`[opentp] ${msg}`, options?.showPayload !== false ? event.payload : '');
    });
  const areas = options?.areas ? new Set(options.areas) : null;

  return (event, next) => {
    // Filter by area if specified
    if (areas && !areas.has(event.area)) {
      next(event);
      return;
    }

    logger(`📊 ${event.key}`, event);
    next(event);
  };
}
