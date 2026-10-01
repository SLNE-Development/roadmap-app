import { describe, expect, it, vi } from "vitest";
import { memoryBus, type EventBus } from "@/lib/bus";
import { createHub } from "./hub";

function spyBus() {
  const inner = memoryBus();
  const spy = { subscribes: 0, unsubscribes: 0 };
  const bus: EventBus = {
    publish: (channel, message) => inner.publish(channel, message),
    async subscribe(channel, handler) {
      spy.subscribes++;
      const off = await inner.subscribe(channel, handler);
      return () => {
        spy.unsubscribes++;
        off();
      };
    },
  };
  return { bus, spy };
}

describe("createHub", () => {
  it("shares one bus subscription per channel and fans out", async () => {
    const { bus, spy } = spyBus();
    const hub = createHub(bus);
    const a = vi.fn();
    const b = vi.fn();
    await hub.join("project:p1", a);
    await hub.join("project:p1", b);
    expect(spy.subscribes).toBe(1);
    await bus.publish("project:p1", { keys: ["x"] });
    expect(a).toHaveBeenCalledWith({ keys: ["x"] });
    expect(b).toHaveBeenCalledWith({ keys: ["x"] });
  });

  it("isolates channels", async () => {
    const { bus } = spyBus();
    const hub = createHub(bus);
    const one = vi.fn();
    const two = vi.fn();
    await hub.join("project:p1", one);
    await hub.join("project:p2", two);
    await bus.publish("project:p1", { keys: ["x"] });
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
  });

  it("keeps the subscription until the last leave", async () => {
    const { bus, spy } = spyBus();
    const hub = createHub(bus);
    const a = vi.fn();
    const b = vi.fn();
    const leaveA = await hub.join("project:p1", a);
    const leaveB = await hub.join("project:p1", b);
    leaveA();
    expect(hub.size("project:p1")).toBe(1);
    await bus.publish("project:p1", { keys: ["x"] });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(spy.unsubscribes).toBe(0);
    leaveB();
    await Promise.resolve();
    expect(spy.unsubscribes).toBe(1);
    expect(hub.size("project:p1")).toBe(0);
  });

  it("treats a second leave as a no-op", async () => {
    const { bus, spy } = spyBus();
    const hub = createHub(bus);
    const leave = await hub.join("project:p1", vi.fn());
    const other = await hub.join("project:p1", vi.fn());
    leave();
    leave();
    expect(hub.size("project:p1")).toBe(1);
    other();
    other();
    await Promise.resolve();
    expect(hub.size("project:p1")).toBe(0);
    expect(spy.unsubscribes).toBe(1);
  });

  it("keeps delivering when a listener throws", async () => {
    const { bus } = spyBus();
    const hub = createHub(bus);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    await hub.join("project:p1", () => {
      throw new Error("boom");
    });
    await hub.join("project:p1", after);
    await bus.publish("project:p1", { keys: ["x"] });
    expect(after).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("subscribes once for concurrent joins on a new channel", async () => {
    const { bus, spy } = spyBus();
    const hub = createHub(bus);
    const a = vi.fn();
    const b = vi.fn();
    await Promise.all([hub.join("project:p1", a), hub.join("project:p1", b)]);
    expect(spy.subscribes).toBe(1);
    await bus.publish("project:p1", { keys: ["x"] });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("drops the listener and lets a later join retry when subscribing fails", async () => {
    const inner = memoryBus();
    let fail = true;
    const bus: EventBus = {
      publish: inner.publish,
      subscribe: (channel, handler) => (fail ? Promise.reject(new Error("down")) : inner.subscribe(channel, handler)),
    };
    const hub = createHub(bus);
    await expect(hub.join("project:p1", vi.fn())).rejects.toThrow("down");
    expect(hub.size("project:p1")).toBe(0);
    fail = false;
    const listener = vi.fn();
    await hub.join("project:p1", listener);
    await bus.publish("project:p1", { keys: ["x"] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
