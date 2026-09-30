import Redis from "ioredis";

/** Process-wide cache so hot reloads and concurrent requests share one connection. */
const globalForValkey = globalThis as unknown as { roadmapValkey?: Redis };

/**
 * Returns the shared Valkey client, connecting to `VALKEY_URL`.
 * `maxRetriesPerRequest: null` keeps it usable by BullMQ workers.
 *
 * @throws Error if `VALKEY_URL` is unset
 */
export function getValkey(): Redis {
  if (!globalForValkey.roadmapValkey) {
    const url = process.env.VALKEY_URL;
    if (!url) throw new Error("VALKEY_URL is not set; see .env.example.");
    globalForValkey.roadmapValkey = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  }
  return globalForValkey.roadmapValkey;
}

/** Closes the shared client, if any, and clears the cache. */
export async function closeValkey(): Promise<void> {
  const client = globalForValkey.roadmapValkey;
  globalForValkey.roadmapValkey = undefined;
  if (client) await client.quit();
}

/**
 * Pings Valkey; resolves `true` on `PONG` within 1000 ms and `false` on any error or timeout.
 * Never throws.
 */
export async function pingValkey(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("valkey ping timed out")), 1000);
    });
    return (await Promise.race([getValkey().ping(), timeout])) === "PONG";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
