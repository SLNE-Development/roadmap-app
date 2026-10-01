import { valkeyBus, type EventBus } from "@/lib/bus";

type Listener = (message: object) => void;

/** One bus subscription per channel, fanned out to every open stream of this process. */
export interface Hub {
  /**
   * Resolves a leave function (safe to call more than once) once the channel subscription is active.
   * An abort of `signal` while waiting removes the listener at once and rejects with the abort reason.
   */
  join(channel: string, listener: Listener, signal?: AbortSignal): Promise<() => void>;
  /** Number of listeners currently joined to `channel`. */
  size(channel: string): number;
}

export function createHub(bus: EventBus): Hub {
  type Entry = { listeners: Set<Listener>; ready: Promise<() => void> };
  const channels = new Map<string, Entry>();

  return {
    async join(channel, listener, signal) {
      let entry = channels.get(channel);
      if (!entry) {
        const created: Entry = { listeners: new Set(), ready: Promise.resolve(() => {}) };
        created.ready = bus
          .subscribe(channel, (message) => {
            for (const each of [...created.listeners]) {
              try {
                each(message);
              } catch (error) {
                console.error("realtime listener failed", error);
              }
            }
          })
          .catch((error: unknown) => {
            if (channels.get(channel) === created) channels.delete(channel);
            throw error;
          });
        channels.set(channel, created);
        entry = created;
      }
      const joined = entry;
      joined.listeners.add(listener);
      const leaveEntry = () => {
        if (!joined.listeners.delete(listener)) return;
        if (joined.listeners.size === 0 && channels.get(channel) === joined) {
          channels.delete(channel);
          joined.ready.then((unsubscribe) => unsubscribe(), () => {});
        }
      };
      let onAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
          leaveEntry();
          reject(signal?.reason ?? new Error("aborted"));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
      aborted.catch(() => {});
      try {
        await Promise.race([joined.ready, aborted]);
      } catch (error) {
        joined.listeners.delete(listener);
        throw error;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      return leaveEntry;
    },
    size: (channel) => channels.get(channel)?.listeners.size ?? 0,
  };
}

/** Process-wide cache so hot reloads and concurrent requests share one hub. */
const globalForHub = globalThis as unknown as { roadmapHub?: Hub };

/** The hub on top of `valkeyBus()`; its single subscriber connection serves every channel. */
export function getHub(): Hub {
  return (globalForHub.roadmapHub ??= createHub(valkeyBus()));
}
