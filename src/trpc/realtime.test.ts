import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createKeyBatcher, HIDDEN_CLOSE_MS, openProjectEvents, type EventSourceLike } from "./realtime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("backoffDelay", () => {
  it("doubles from one second and caps at one minute", () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, mid)).toBe(1000);
    expect(backoffDelay(1, mid)).toBe(2000);
    expect(backoffDelay(3, mid)).toBe(8000);
    expect(backoffDelay(10, mid)).toBe(60_000);
  });
  it("jitters by a quarter either way", () => {
    expect(backoffDelay(0, () => 0)).toBe(750);
    expect(backoffDelay(0, () => 0.999)).toBeLessThan(1250);
  });
});

describe("createKeyBatcher", () => {
  it("flushes the merged keys once after the quiet time", () => {
    const flush = vi.fn();
    const batcher = createKeyBatcher(flush, 300);
    batcher.add(["systems"]);
    vi.advanceTimersByTime(100);
    batcher.add(["history", "systems"]);
    vi.advanceTimersByTime(299);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(["history", "systems"]);
  });
  it("flushes a steady stream at least every second", () => {
    const flush = vi.fn();
    const batcher = createKeyBatcher(flush, 300);
    for (let i = 0; i < 12; i++) {
      batcher.add(["systems"]);
      vi.advanceTimersByTime(100);
    }
    expect(flush).toHaveBeenCalledTimes(1);
  });
  it("drops pending keys on cancel", () => {
    const flush = vi.fn();
    const batcher = createKeyBatcher(flush, 300);
    batcher.add(["systems"]);
    batcher.cancel();
    vi.advanceTimersByTime(5000);
    expect(flush).not.toHaveBeenCalled();
  });
});

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  closed = false;
  private listeners = new Map<string, (event: { data?: string }) => void>();
  constructor() {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: string) {
    this.listeners.get(type)?.({ data });
  }
}

function start() {
  FakeSource.all = [];
  const invalidate = vi.fn();
  const events = openProjectEvents({ createSource: () => new FakeSource(), invalidate, allowed: ["systems", "history", "presence"] });
  return { events, invalidate, last: () => FakeSource.all[FakeSource.all.length - 1] };
}

describe("openProjectEvents", () => {
  it("invalidates only the named, known routers, batched", () => {
    const { invalidate, last } = start();
    last().emit("ready");
    last().emit("message", JSON.stringify({ keys: ["systems", "bogus"] }));
    last().emit("message", "not json");
    vi.advanceTimersByTime(300);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith(["systems"]);
  });

  it("reconnects with backoff and catches up exactly once", () => {
    const { invalidate, last } = start();
    last().emit("ready");
    const first = last();
    first.emit("error");
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(1250);
    expect(FakeSource.all).toHaveLength(2);
    last().emit("error");
    vi.advanceTimersByTime(2500);
    expect(FakeSource.all).toHaveLength(3);
    expect(invalidate).not.toHaveBeenCalled();
    last().emit("ready");
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith(["systems", "history", "presence"]);
    vi.advanceTimersByTime(120_000);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(FakeSource.all).toHaveLength(3);
  });

  it("does not refetch on the first ready", () => {
    const { invalidate, last } = start();
    last().emit("ready");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stops reconnecting after gone", () => {
    const { last } = start();
    last().emit("ready");
    const source = last();
    source.emit("gone");
    source.emit("error");
    vi.advanceTimersByTime(300_000);
    expect(source.closed).toBe(true);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("closes a tab hidden for a minute and reopens it with a catch-up", () => {
    const { invalidate, last, events } = start();
    last().emit("ready");
    events.setVisible(false);
    vi.advanceTimersByTime(HIDDEN_CLOSE_MS - 1);
    expect(last().closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(last().closed).toBe(true);
    events.setVisible(true);
    expect(FakeSource.all).toHaveLength(2);
    last().emit("ready");
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("keeps the stream when the tab is shown again in time", () => {
    const { last, events } = start();
    last().emit("ready");
    events.setVisible(false);
    vi.advanceTimersByTime(30_000);
    events.setVisible(true);
    vi.advanceTimersByTime(120_000);
    expect(FakeSource.all).toHaveLength(1);
    expect(last().closed).toBe(false);
  });

  it("stops everything on close", () => {
    const { last, events } = start();
    last().emit("ready");
    last().emit("error");
    events.close();
    vi.advanceTimersByTime(120_000);
    expect(FakeSource.all).toHaveLength(1);
  });
});
