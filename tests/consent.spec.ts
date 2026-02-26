import { describe, expect, it } from "vitest";
import { ConsentManager } from "../src/consent";
import type { DispatchedEvent } from "../src/types";

function mockEvent(area: string, key: string): DispatchedEvent {
  return {
    area,
    eventName: key.split("::")[1] || "event",
    key,
    payload: {},
    timestamp: Date.now(),
    metadata: {},
  };
}

describe("ConsentManager", () => {
  it("allows necessary events by default", () => {
    const manager = new ConsentManager();
    const event = mockEvent("auth", "auth::login");

    manager.update({ necessary: true });
    // Default category is analytics, which is false by default
    expect(manager.isAllowed(event)).toBe(false);
  });

  it("blocks analytics events when not consented", () => {
    const manager = new ConsentManager({ defaultCategory: "analytics" });
    const event = mockEvent("auth", "auth::login");

    expect(manager.isAllowed(event)).toBe(false);
  });

  it("allows events after consent is granted", () => {
    const manager = new ConsentManager({ defaultCategory: "analytics" });
    const event = mockEvent("auth", "auth::login");

    manager.update({ analytics: true });
    expect(manager.isAllowed(event)).toBe(true);
  });

  it("uses area mapping", () => {
    const manager = new ConsentManager({
      mapping: { auth: "necessary" },
      defaultCategory: "analytics",
    });

    const authEvent = mockEvent("auth", "auth::login");
    const otherEvent = mockEvent("ecommerce", "ecommerce::purchase");

    expect(manager.isAllowed(authEvent)).toBe(true); // necessary is true by default
    expect(manager.isAllowed(otherEvent)).toBe(false); // analytics is false by default
  });

  it("uses exact key mapping over area mapping", () => {
    const manager = new ConsentManager({
      mapping: {
        auth: "necessary",
        "auth::login": "marketing",
      },
      defaultState: { necessary: true, marketing: false },
    });

    const loginEvent = mockEvent("auth", "auth::login");
    const logoutEvent = mockEvent("auth", "auth::logout");

    expect(manager.isAllowed(loginEvent)).toBe(false); // marketing takes precedence
    expect(manager.isAllowed(logoutEvent)).toBe(true); // falls back to area (necessary)
  });

  it("supports wildcard mapping", () => {
    const manager = new ConsentManager({
      mapping: { "auth::*": "functional" },
      defaultState: { functional: true },
    });

    const event = mockEvent("auth", "auth::login");
    expect(manager.isAllowed(event)).toBe(true);
  });

  it("returns current state", () => {
    const manager = new ConsentManager();
    const state = manager.getState();

    expect(state.necessary).toBe(true);
    expect(state.analytics).toBe(false);
    expect(state.marketing).toBe(false);
    expect(state.functional).toBe(false);
  });
});
