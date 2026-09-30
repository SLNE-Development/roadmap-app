import { beforeEach, describe, expect, it } from "vitest";
import { memoryKv, type Kv } from "./kv";

let t = 0;
let kv: Kv;

beforeEach(() => {
  t = 0;
  kv = memoryKv(() => t);
});

describe("memoryKv", () => {
  it("sets and gets values", async () => {
    await kv.set("a", "1");
    expect(await kv.get("a")).toBe("1");
    expect(await kv.get("missing")).toBeNull();
  });

  it("expires values after their ttl", async () => {
    await kv.set("a", "1", 10);
    t = 9_999;
    expect(await kv.get("a")).toBe("1");
    t = 10_000;
    expect(await kv.get("a")).toBeNull();
  });

  it("setIfAbsent only sets absent or expired keys", async () => {
    expect(await kv.setIfAbsent("l", "x", 5)).toBe(true);
    expect(await kv.setIfAbsent("l", "y", 5)).toBe(false);
    expect(await kv.get("l")).toBe("x");
    t = 5_001;
    expect(await kv.setIfAbsent("l", "y", 5)).toBe(true);
  });

  it("stores hashes", async () => {
    await kv.hset("h", "f1", "a");
    await kv.hset("h", "f2", "b");
    expect(await kv.hgetall("h")).toEqual({ f1: "a", f2: "b" });
    expect(await kv.hgetall("none")).toEqual({});
  });

  it("applies a hash ttl to the whole hash", async () => {
    await kv.hset("h", "f", "a", 2);
    await kv.hset("h", "g", "b");
    t = 2_000;
    expect(await kv.hgetall("h")).toEqual({});
  });

  it("increments counters and only sets the ttl on creation", async () => {
    expect(await kv.incr("c")).toBe(1);
    expect(await kv.incr("c")).toBe(2);
    expect(await kv.incr("c2", 1)).toBe(1);
    t = 500;
    expect(await kv.incr("c2", 1)).toBe(2);
    t = 1_000;
    expect(await kv.incr("c2", 1)).toBe(1);
  });

  it("deletes keys", async () => {
    await kv.set("a", "1");
    await kv.del("a");
    expect(await kv.get("a")).toBeNull();
  });
});
