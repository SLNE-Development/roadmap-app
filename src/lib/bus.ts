import type Redis from "ioredis";
import { getProducerValkey } from "./valkey";

/** Channel-based pub/sub; Valkey in production, in memory in unit tests. */
export interface EventBus {
  publish(channel: string, message: object): Promise<void>;
  /** Resolves an unsubscribe function once the subscription is active. */
  subscribe(channel: string, handler: (message: object) => void): Promise<() => void>;
}

/** Runs `handler`, logging instead of propagating a throw so one handler cannot break the others or crash the process. */
function safely(handler: (message: object) => void, message: object): void {
  try {
    handler(message);
  } catch (error) {
    console.error("bus handler failed", error);
  }
}

/** In-memory bus that delivers synchronously within `publish`, in subscription order. */
export function memoryBus(): EventBus {
  const handlers = new Map<string, Set<(message: object) => void>>();
  return {
    async publish(channel, message) {
      for (const handler of [...(handlers.get(channel) ?? [])]) safely(handler, message);
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

/**
 * Bus backed by Valkey pub/sub; channels are stored as `prefix + channel`. Publishes and the `.duplicate()`
 * subscriber use the fail-fast producer client by default, so a Valkey outage rejects instead of hanging.
 * A throwing handler is logged and does not stop the others.
 */
export function valkeyBus(opts: { client?: Redis; prefix?: string } = {}): EventBus {
  const prefix = opts.prefix ?? "roadmap:";
  const client = () => opts.client ?? getProducerValkey();
  type Entry = { handlers: Set<(message: object) => void>; ready: Promise<unknown> };
  const channels = new Map<string, Entry>();
  let subscriber: Redis | undefined;

  function getSubscriber(): Redis {
    if (!subscriber) {
      // The producer client is fail-fast (no offline queue, 1 s timeout); a subscriber must queue commands while
      // connecting and re-subscribe after reconnects, so it gets blocking-friendly options.
      subscriber = client().duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, commandTimeout: undefined });
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
        for (const handler of [...set]) safely(handler, message);
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
