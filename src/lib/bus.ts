import type Redis from "ioredis";
import { getValkey } from "./valkey";

/** Channel-based pub/sub; Valkey in production, in memory in unit tests. */
export interface EventBus {
  publish(channel: string, message: object): Promise<void>;
  /** Resolves an unsubscribe function once the subscription is active. */
  subscribe(channel: string, handler: (message: object) => void): Promise<() => void>;
}

/** In-memory bus that delivers synchronously within `publish`, in subscription order. */
export function memoryBus(): EventBus {
  const handlers = new Map<string, Set<(message: object) => void>>();
  return {
    async publish(channel, message) {
      for (const handler of [...(handlers.get(channel) ?? [])]) handler(message);
    },
    async subscribe(channel, handler) {
      let set = handlers.get(channel);
      if (!set) handlers.set(channel, (set = new Set()));
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
  };
}

/** Bus backed by Valkey pub/sub; channels are stored as `prefix + channel`. */
export function valkeyBus(opts: { client?: Redis; prefix?: string } = {}): EventBus {
  const prefix = opts.prefix ?? "roadmap:";
  const client = () => opts.client ?? getValkey();
  type Entry = { handlers: Set<(message: object) => void>; ready: Promise<unknown> };
  const channels = new Map<string, Entry>();
  let subscriber: Redis | undefined;

  function getSubscriber(): Redis {
    if (!subscriber) {
      subscriber = client().duplicate();
      subscriber.on("message", (key: string, raw: string) => {
        const set = channels.get(key.slice(prefix.length))?.handlers;
        if (!set) return;
        let message: object;
        try {
          message = JSON.parse(raw) as object;
        } catch {
          console.warn(`dropping malformed message on ${key}`);
          return;
        }
        for (const handler of [...set]) handler(message);
      });
    }
    return subscriber;
  }

  return {
    async publish(channel, message) {
      await client().publish(prefix + channel, JSON.stringify(message));
    },
    async subscribe(channel, handler) {
      let entry = channels.get(channel);
      if (!entry) {
        const created: Entry = { handlers: new Set(), ready: Promise.resolve() };
        created.ready = getSubscriber()
          .subscribe(prefix + channel)
          .catch((error: unknown) => {
            if (channels.get(channel) === created) channels.delete(channel);
            throw error;
          });
        channels.set(channel, created);
        entry = created;
      }
      const joined = entry;
      joined.handlers.add(handler);
      try {
        await joined.ready;
      } catch (error) {
        joined.handlers.delete(handler);
        throw error;
      }
      return () => {
        joined.handlers.delete(handler);
        if (joined.handlers.size === 0 && channels.get(channel) === joined) {
          channels.delete(channel);
          void subscriber?.unsubscribe(prefix + channel).catch(() => {});
        }
      };
    },
  };
}
