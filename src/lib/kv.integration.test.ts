import Redis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { testValkeyUrl, uniquePrefix } from "@/test/valkey";
import { valkeyKv } from "./kv";

const client = new Redis(testValkeyUrl(), { maxRetriesPerRequest: null });
const kv = valkeyKv({ client, prefix: uniquePrefix() });

afterAll(async () => {
  await client.quit();
});

describe("valkeyKv", () => {
  it("sets and gets values", async () => {
    await kv.set("a", "1");
    expect(await kv.get("a")).toBe("1");
    expect(await kv.get("missing")).toBeNull();
  });

  it("expires values after their ttl", async () => {
    await kv.set("a", "1", 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await kv.get("a")).toBeNull();
  });

  it("setIfAbsent only sets absent keys", async () => {
    expect(await kv.setIfAbsent("l", "x", 5)).toBe(true);
    expect(await kv.setIfAbsent("l", "y", 5)).toBe(false);
    expect(await kv.get("l")).toBe("x");
  });

  it("stores hashes", async () => {
    await kv.hset("h", "f1", "a");
    await kv.hset("h", "f2", "b");
    expect(await kv.hgetall("h")).toEqual({ f1: "a", f2: "b" });
    expect(await kv.hgetall("none")).toEqual({});
  });

  it("applies a hash ttl to the whole hash", async () => {
    await kv.hset("ht", "f", "a", 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await kv.hgetall("ht")).toEqual({});
  });

  it("increments counters and only sets the ttl on creation", async () => {
    expect(await kv.incr("c")).toBe(1);
    expect(await kv.incr("c")).toBe(2);
    expect(await kv.incr("c2", 1)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await kv.incr("c2", 1)).toBe(1);
  });

  it("deletes keys", async () => {
    await kv.set("a", "1");
    await kv.del("a");
    expect(await kv.get("a")).toBeNull();
  });
});
