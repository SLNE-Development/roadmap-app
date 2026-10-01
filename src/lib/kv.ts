import type Redis from "ioredis";
import { getProducerValkey } from "./valkey";

/** Small key-value store with TTLs; Valkey in production, in memory in unit tests. */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Sets the key only when absent; resolves whether it was set. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Sets a hash field; a TTL applies to the whole hash. */
  hset(key: string, field: string, value: string, ttlSeconds?: number): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  /** Increments a counter; a TTL is set only when the call creates the key. */
  incr(key: string, ttlSeconds?: number): Promise<number>;
}

/** Returns the results of a `multi().exec()` reply, throwing on a null reply or the first command error. */
function unwrap(res: [Error | null, unknown][] | null): unknown[] {
  if (!res) throw new Error("valkey transaction returned no result");
  return res.map(([err, value]) => {
    if (err) throw err;
    return value;
  });
}

/**
 * Kv backed by Valkey; every key is stored as `prefix + key`, by default `roadmap:kv:` so keys cannot collide
 * with BullMQ's `roadmap:<queue>:<jobId>`. Uses the fail-fast producer client by default, so calls reject
 * quickly while Valkey is down.
 */
export function valkeyKv(opts: { client?: Redis; prefix?: string } = {}): Kv {
  const prefix = opts.prefix ?? "roadmap:kv:";
  const client = () => opts.client ?? getProducerValkey();
  return {
    async get(key) {
      return client().get(prefix + key);
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds === undefined) await client().set(prefix + key, value);
      else await client().set(prefix + key, value, "EX", ttlSeconds);
    },
    async setIfAbsent(key, value, ttlSeconds) {
      return (await client().set(prefix + key, value, "EX", ttlSeconds, "NX")) === "OK";
    },
    async del(key) {
      await client().del(prefix + key);
    },
    async hset(key, field, value, ttlSeconds) {
      if (ttlSeconds === undefined) {
        await client().hset(prefix + key, field, value);
        return;
      }
      unwrap(await client().multi().hset(prefix + key, field, value).expire(prefix + key, ttlSeconds).exec());
    },
    async hgetall(key) {
      return client().hgetall(prefix + key);
    },
    async incr(key, ttlSeconds) {
      if (ttlSeconds === undefined) return client().incr(prefix + key);
      const res = await client().multi().incr(prefix + key).expire(prefix + key, ttlSeconds, "NX").exec();
      return unwrap(res)[0] as number;
    },
  };
}

type Entry = { value: string | Map<string, string>; expiresAt: number | null };

/** In-memory Kv with the same semantics as `valkeyKv`; `now` returns milliseconds. */
export function memoryKv(now: () => number = Date.now): Kv {
  const store = new Map<string, Entry>();
  const live = (key: string): Entry | undefined => {
    const entry = store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  const expiry = (ttlSeconds: number) => now() + ttlSeconds * 1000;
  return {
    async get(key) {
      const entry = live(key);
      return typeof entry?.value === "string" ? entry.value : null;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value, expiresAt: ttlSeconds === undefined ? null : expiry(ttlSeconds) });
    },
    async setIfAbsent(key, value, ttlSeconds) {
      if (live(key)) return false;
      store.set(key, { value, expiresAt: expiry(ttlSeconds) });
      return true;
    },
    async del(key) {
      store.delete(key);
    },
    async hset(key, field, value, ttlSeconds) {
      let entry = live(key);
      if (!entry || typeof entry.value === "string") {
        entry = { value: new Map(), expiresAt: null };
        store.set(key, entry);
      }
      (entry.value as Map<string, string>).set(field, value);
      if (ttlSeconds !== undefined) entry.expiresAt = expiry(ttlSeconds);
    },
    async hgetall(key) {
      const entry = live(key);
      return entry && typeof entry.value !== "string" ? Object.fromEntries(entry.value) : {};
    },
    async incr(key, ttlSeconds) {
      const entry = live(key);
      const next = (entry && typeof entry.value === "string" ? Number(entry.value) : 0) + 1;
      if (entry) entry.value = String(next);
      else store.set(key, { value: String(next), expiresAt: ttlSeconds === undefined ? null : expiry(ttlSeconds) });
      return next;
    },
  };
}
