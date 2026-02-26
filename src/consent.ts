import type { ConsentCategory, ConsentConfig, ConsentState, DispatchedEvent } from './types';

export class ConsentManager {
  private state: ConsentState;
  private mapping: Record<string, ConsentCategory>;
  private defaultCategory: ConsentCategory;

  constructor(config?: ConsentConfig) {
    this.state = {
      necessary: true,
      analytics: false,
      marketing: false,
      functional: false,
      ...config?.defaultState,
    };
    this.mapping = config?.mapping ?? {};
    this.defaultCategory = config?.defaultCategory ?? 'analytics';
  }

  /** Check if an event is allowed by current consent */
  isAllowed(event: DispatchedEvent): boolean {
    const category = this.getCategory(event);
    return this.state[category] === true;
  }

  /** Get the consent category for an event */
  private getCategory(event: DispatchedEvent): ConsentCategory {
    // Check by exact key first: "auth::login"
    if (this.mapping[event.key]) return this.mapping[event.key];
    // Check by area: "auth"
    if (this.mapping[event.area]) return this.mapping[event.area];
    // Check by wildcard: "auth::*" (strip event part)
    const wildcardKey = `${event.area}::*`;
    if (this.mapping[wildcardKey]) return this.mapping[wildcardKey];
    // Default
    return this.defaultCategory;
  }

  /** Update consent state */
  update(partial: Partial<ConsentState>): void {
    Object.assign(this.state, partial);
  }

  /** Get current state (copy) */
  getState(): ConsentState {
    return { ...this.state };
  }
}
