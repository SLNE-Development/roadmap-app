import { describe, expect, it, vi } from "vitest";
import { memoryBus } from "./bus";

describe("memoryBus", () => {
  it("delivers a published message to a subscriber of the channel", async () => {
    const bus = memoryBus();
    const handler = vi.fn();
    await bus.subscribe("project:p1", handler);
    await bus.publish("project:p1", { keys: ["systems"] });
    expect(handler).toHaveBeenCalledWith({ keys: ["systems"] });
  });

  it("does not deliver to other channels", async () => {
    const bus = memoryBus();
    const handler = vi.fn();
    await bus.subscribe("project:p2", handler);
    await bus.publish("project:p1", { keys: ["systems"] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", async () => {
    const bus = memoryBus();
    const handler = vi.fn();
    const unsubscribe = await bus.subscribe("project:p1", handler);
    unsubscribe();
    await bus.publish("project:p1", { keys: ["systems"] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to every handler on a channel", async () => {
    const bus = memoryBus();
    const a = vi.fn();
    const b = vi.fn();
    await bus.subscribe("project:p1", a);
    await bus.subscribe("project:p1", b);
    await bus.publish("project:p1", { keys: [] });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("keeps delivering to later handlers when one throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = memoryBus();
    const second = vi.fn();
    await bus.subscribe("project:p1", () => {
      throw new Error("boom");
    });
    await bus.subscribe("project:p1", second);
    await bus.publish("project:p1", { keys: [] });
    expect(second).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
