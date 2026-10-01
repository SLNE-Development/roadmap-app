import { INVALIDATES } from "./invalidation";

/** Router names a change notice may name: every mutation router plus `presence`. */
export const REALTIME_KEYS: readonly string[] = [...Object.keys(INVALIDATES), "presence"];

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60_000;
const BATCH_DEBOUNCE_MS = 300;
const BATCH_MAX_WAIT_MS = 1000;
/** How long a hidden tab keeps its stream open. */
export const HIDDEN_CLOSE_MS = 60_000;

/**
 * Delay before reconnect attempt `attempt` (0-based): exponential from 1 s, capped at 60 s, with ±25% jitter.
 *
 * @param attempt number of failed attempts so far
 * @param random source of jitter in `[0, 1)`
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return base * (0.75 + random() * 0.5);
}

/**
 * Collects keys and flushes them together once no key arrived for `delayMs`, or at the latest 1 s after the first pending key.
 *
 * @param flush receives the distinct pending keys, sorted
 * @param delayMs quiet time before a flush
 */
export function createKeyBatcher(flush: (keys: string[]) => void, delayMs: number): { add(keys: string[]): void; cancel(): void } {
  let pending = new Set<string>();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let maxWait: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(debounce);
    clearTimeout(maxWait);
    debounce = maxWait = undefined;
    pending = new Set();
  };
  const run = () => {
    const keys = [...pending].sort();
    cancel();
    if (keys.length > 0) flush(keys);
  };
  return {
    add(keys) {
      if (keys.length === 0) return;
      for (const key of keys) pending.add(key);
      clearTimeout(debounce);
      debounce = setTimeout(run, delayMs);
      maxWait ??= setTimeout(run, BATCH_MAX_WAIT_MS);
    },
    cancel,
  };
}

/** The part of `EventSource` the connection uses. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
}

export interface ProjectEventsOptions {
  createSource: () => EventSourceLike;
  /** Invalidate the queries of these routers. */
  invalidate: (keys: string[]) => void;
  /** Keys a message may name; others are ignored. */
  allowed?: readonly string[];
}

export interface ProjectEvents {
  /** Reports whether the tab is visible; a tab hidden for 60 s closes its stream, and showing it again reopens it. */
  setVisible(visible: boolean): void;
  close(): void;
}

/**
 * Keeps one change-notice stream open: batches incoming keys into invalidations, reconnects with backoff after an
 * error and refetches every router once after each reconnect. After `gone` it stays closed.
 *
 * @param options the stream factory and the invalidation callback
 */
export function openProjectEvents(options: ProjectEventsOptions): ProjectEvents {
  const allowed = new Set(options.allowed ?? REALTIME_KEYS);
  const batcher = createKeyBatcher(options.invalidate, BATCH_DEBOUNCE_MS);
  let source: EventSourceLike | undefined;
  let attempt = 0;
  let wasReady = false;
  let finished = false;
  let hidden = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const drop = () => {
    source?.close();
    source = undefined;
  };
  const open = () => {
    if (finished || source) return;
    const current = options.createSource();
    source = current;
    current.addEventListener("message", (event) => {
      if (source !== current) return;
      try {
        const parsed: unknown = JSON.parse(event.data ?? "");
        const keys = (parsed as { keys?: unknown } | null)?.keys;
        if (Array.isArray(keys)) batcher.add(keys.filter((key): key is string => typeof key === "string" && allowed.has(key)));
      } catch {
        // not a change notice
      }
    });
    current.addEventListener("ready", () => {
      if (source !== current) return;
      attempt = 0;
      if (wasReady) options.invalidate([...allowed]);
      wasReady = true;
    });
    current.addEventListener("gone", () => {
      if (source !== current) return;
      finished = true;
      drop();
    });
    current.addEventListener("error", () => {
      if (source !== current) return;
      drop();
      if (finished || hidden) return;
      const delay = backoffDelay(attempt++);
      console.debug(`events: reconnecting in ${Math.round(delay)} ms`);
      retry = setTimeout(open, delay);
    });
  };

  open();
  return {
    setVisible(visible) {
      hidden = !visible;
      clearTimeout(hideTimer);
      if (hidden) {
        hideTimer = setTimeout(() => {
          clearTimeout(retry);
          drop();
        }, HIDDEN_CLOSE_MS);
      } else if (!source) {
        clearTimeout(retry);
        open();
      }
    },
    close() {
      finished = true;
      clearTimeout(retry);
      clearTimeout(hideTimer);
      batcher.cancel();
      drop();
    },
  };
}
