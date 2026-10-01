import { invalidationKeys, realtimeChannel } from "@/lib/realtime/keys";
import type { WorkerDeps } from "../deps";
import { registerFeedConsumer, type ChangeEvent } from "../feed";

/**
 * Publishes one `{ keys }` message per project on its realtime channel. Best effort: a failed publish is
 * logged and swallowed so the feed cursor advances; the next change or the reconnect catch-up covers a miss.
 */
export async function handleRealtime(events: ChangeEvent[], deps: WorkerDeps): Promise<void> {
  for (const [projectId, keys] of invalidationKeys(events)) {
    try {
      await deps.bus.publish(realtimeChannel(projectId), { keys });
    } catch (error) {
      console.error("realtime publish failed", error);
    }
  }
}

registerFeedConsumer("realtime", handleRealtime);
