import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryBus } from "@/lib/bus";
import { createHub } from "./hub";
import { createEventStream, SSE_HEADERS } from "./stream";

const decoder = new TextDecoder();

function setup(opts: { recheckEvery?: number; allowed?: boolean } = {}) {
  const bus = memoryBus();
  const hub = createHub(bus);
  const controller = new AbortController();
  const stream = createEventStream({
    hub,
    channel: "project:p1",
    signal: controller.signal,
    recheckEvery: opts.recheckEvery,
    stillAllowed: async () => opts.allowed ?? true,
  });
  const reader = stream.getReader();
  /** Reads the next chunk as text, or null once the stream is done. */
  const next = async () => {
    const result = await reader.read();
    return result.done ? null : decoder.decode(result.value);
  };
  return { bus, hub, controller, reader, next };
}

describe("createEventStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the retry hint and a ready event first", async () => {
    const { next } = setup();
    let text = (await next()) ?? "";
    if (!text.includes("event: ready")) text += (await next()) ?? "";
    expect(text).toBe("retry: 5000\n\nevent: ready\ndata: {}\n\n");
  });

  it("forwards bus messages for its channel only", async () => {
    const { bus, next } = setup();
    await next();
    await bus.publish("project:other", { keys: ["nope"] });
    await bus.publish("project:p1", { keys: ["systems"] });
    expect(await next()).toBe('data: {"keys":["systems"]}\n\n');
  });

  it("forwards only the keys and drops malformed messages", async () => {
    const { bus, next } = setup();
    await next();
    await bus.publish("project:p1", { keys: ["systems"], secret: "x" });
    expect(await next()).toBe('data: {"keys":["systems"]}\n\n');
    await bus.publish("project:p1", { keys: [1] });
    await bus.publish("project:p1", { other: true });
    await bus.publish("project:p1", { keys: ["boards"] });
    expect(await next()).toBe('data: {"keys":["boards"]}\n\n');
  });

  it("stays open and logs when the access recheck fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hub = createHub(memoryBus());
    const controller = new AbortController();
    const reader = createEventStream({
      hub,
      channel: "project:p1",
      signal: controller.signal,
      recheckEvery: 1,
      stillAllowed: async () => {
        throw new Error("db down");
      },
    }).getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(error).toHaveBeenCalled();
    expect(hub.size("project:p1")).toBe(1);
    controller.abort();
    error.mockRestore();
  });

  it("pings every 25 seconds", async () => {
    const { next } = setup();
    await next();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await next()).toBe(": ping\n\n");
  });

  it("says gone and closes when access is lost at a recheck", async () => {
    const { hub, next } = setup({ recheckEvery: 2, allowed: false });
    await next();
    await vi.advanceTimersByTimeAsync(50_000);
    let text = "";
    for (let chunk = await next(); chunk !== null; chunk = await next()) text += chunk;
    expect(text).toContain("event: gone\ndata: {}\n\n");
    expect(hub.size("project:p1")).toBe(0);
  });

  it("keeps streaming while access holds", async () => {
    const { next } = setup({ recheckEvery: 1 });
    await next();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await next()).toBe(": ping\n\n");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await next()).toBe(": ping\n\n");
  });

  it("leaves the hub and stops the heartbeat on abort", async () => {
    const { hub, controller, reader, next } = setup();
    await next();
    expect(hub.size("project:p1")).toBe(1);
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    expect(hub.size("project:p1")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it("does not stay joined when aborted before it joined", async () => {
    const bus = memoryBus();
    const hub = createHub(bus);
    const controller = new AbortController();
    controller.abort();
    const reader = createEventStream({ hub, channel: "project:p1", signal: controller.signal, stillAllowed: async () => true }).getReader();
    expect((await reader.read()).done).toBe(true);
    expect(hub.size("project:p1")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createEventStream while joining", () => {
  it("leaves as soon as the join resolves when aborted while it was pending", async () => {
    const inner = memoryBus();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const hub = createHub({
      publish: (channel, message) => inner.publish(channel, message),
      async subscribe(channel, handler) {
        await gate;
        return inner.subscribe(channel, handler);
      },
    });
    const controller = new AbortController();
    const reader = createEventStream({ hub, channel: "project:p1", signal: controller.signal, stillAllowed: async () => true }).getReader();
    await Promise.resolve();
    expect(hub.size("project:p1")).toBe(1);
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    release();
    await vi.waitFor(() => expect(hub.size("project:p1")).toBe(0));
  });
});

describe("SSE_HEADERS", () => {
  it("disables caching and proxy buffering", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream; charset=utf-8");
    expect(SSE_HEADERS["Cache-Control"]).toBe("no-cache, no-transform");
    expect(SSE_HEADERS["X-Accel-Buffering"]).toBe("no");
  });
});
