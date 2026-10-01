import Redis, { type RedisOptions } from "ioredis";

/** Process-wide cache so hot reloads and concurrent requests share one connection per client. */
const globalForValkey = globalThis as unknown as { roadmapValkey?: Redis; roadmapProducerValkey?: Redis };

/** Options of the fail-fast client used by web requests and producers. */
export const PRODUCER_OPTIONS: RedisOptions = { enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 1000 };

const ERROR_LOG_INTERVAL_MS = 30_000;

/** Logs connection errors of `client` at most once per 30 s, so reconnects neither spam nor go unhandled. */
function logErrorsThrottled(client: Redis): void {
  let last = 0;
  client.on("error", (error: Error) => {
    const now = Date.now();
    if (now - last < ERROR_LOG_INTERVAL_MS) return;
    last = now;
    console.error(`valkey connection error: ${error.message}`);
  });
}

function valkeyUrl(): string {
  const url = process.env.VALKEY_URL;
  if (!url) throw new Error("VALKEY_URL is not set; see .env.example.");
  return url;
}

/**
 * Returns the shared blocking-capable Valkey client, connecting to `VALKEY_URL`.
 * `maxRetriesPerRequest: null` with the offline queue keeps it usable by BullMQ workers, but commands wait
 * for Valkey while it is down; web requests must use {@link getProducerValkey} instead.
 *
 * @throws Error if `VALKEY_URL` is unset
 */
export function getValkey(): Redis {
  if (!globalForValkey.roadmapValkey) {
    const client = new Redis(valkeyUrl(), { maxRetriesPerRequest: null, lazyConnect: false });
    logErrorsThrottled(client);
    globalForValkey.roadmapValkey = client;
  }
  return globalForValkey.roadmapValkey;
}

/**
 * Returns the shared fail-fast Valkey client for web requests and producers: no offline queue, one retry and a
 * 1 s command timeout, so a Valkey outage rejects commands quickly instead of hanging the request.
 *
 * @throws Error if `VALKEY_URL` is unset
 */
export function getProducerValkey(): Redis {
  if (!globalForValkey.roadmapProducerValkey) {
    const client = new Redis(valkeyUrl(), PRODUCER_OPTIONS);
    logErrorsThrottled(client);
    globalForValkey.roadmapProducerValkey = client;
  }
  return globalForValkey.roadmapProducerValkey;
}

/** Closes both shared clients, if any, and clears the caches. */
export async function closeValkey(): Promise<void> {
  const clients = [globalForValkey.roadmapValkey, globalForValkey.roadmapProducerValkey];
  globalForValkey.roadmapValkey = undefined;
  globalForValkey.roadmapProducerValkey = undefined;
  await Promise.all(
    clients.map(async (client) => {
      if (!client) return;
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
}

/**
 * Pings Valkey through the producer client; resolves `true` on `PONG` within 1000 ms and `false` on any error
 * or timeout. Never throws.
 */
export async function pingValkey(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("valkey ping timed out")), 1000);
    });
    return (await Promise.race([getProducerValkey().ping(), timeout])) === "PONG";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
