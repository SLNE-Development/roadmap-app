import type { Hub } from "./hub";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform keeps Next's compression from buffering the stream; X-Accel-Buffering does the same for nginx.
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export interface EventStreamOptions {
  hub: Hub;
  channel: string;
  signal: AbortSignal;
  heartbeatMs?: number;
  /** Re-checks access on every n-th heartbeat (12 beats of 25 s is about 5 minutes). */
  recheckEvery?: number;
  stillAllowed: () => Promise<boolean>;
}

/**
 * A server-sent-events body for one channel: forwards hub messages, pings to keep proxies open and, on
 * every n-th heartbeat, asks `stillAllowed`; when it says no the stream sends `event: gone` and closes.
 */
export function createEventStream(opts: EventStreamOptions): ReadableStream<Uint8Array> {
  const { hub, channel, signal, stillAllowed } = opts;
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const recheckEvery = opts.recheckEvery ?? 12;
  const encoder = new TextEncoder();
  let close = () => {};

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const heartbeat: { timer?: ReturnType<typeof setInterval> } = {};
      let leave = () => {};
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat.timer);
        leave();
        try {
          controller.close();
        } catch {
          // already closed by the consumer
        }
      };
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };

      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) return close();

      // Pings start before the join: while Valkey is down the join waits, and proxies must not time the stream out.
      let beats = 0;
      heartbeat.timer = setInterval(() => {
        send(": ping\n\n");
        if (++beats % recheckEvery !== 0) return;
        stillAllowed()
          .catch((error: unknown) => {
            // A transient failure keeps the stream open for one more interval; messages carry no content.
            console.error("realtime access recheck failed", error);
            return true;
          })
          .then((allowed) => {
            if (allowed || closed) return;
            send("event: gone\ndata: {}\n\n");
            close();
          });
      }, heartbeatMs);

      try {
        leave = await hub.join(
          channel,
          (message) => {
            // Only the router names go out, never anything else a bus message might carry.
            const { keys } = message as { keys?: unknown };
            if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) return;
            send(`data: ${JSON.stringify({ keys })}\n\n`);
          },
          signal,
        );
      } catch (error) {
        if (closed) return;
        console.error("realtime join failed", error);
        closed = true;
        clearInterval(heartbeat.timer);
        controller.error(error);
        return;
      }
      if (closed) return leave();

      send("retry: 5000\n\nevent: ready\ndata: {}\n\n");
    },
    cancel() {
      close();
    },
  });
}
