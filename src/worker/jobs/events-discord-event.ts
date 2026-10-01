import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { eventBriefVersion, eventRequest, eventSettings, requestLog, type BotStatus, type EventRequestRow } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { createScheduledEvent, deleteScheduledEvent, scheduledEventUrl, updateScheduledEvent, type BotResult, type ScheduledEventBody } from "@/lib/discord-bot";
import { eventPayload } from "@/lib/event-messages";
import { loadEventSecrets, type EventSecrets } from "@/lib/event-secrets";
import { loadPostSettings, type PostSettings } from "@/lib/ops/event-settings";
import { readUploadForWorker } from "@/lib/ops/uploads";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob } from "../jobs";

/** Discord limits an event image; a bigger banner is skipped and the event is created without it. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RETRIES = 10;

/** Thrown by {@link ensureDiscordEvent} on a 429, so the `events.post` job can queue itself again after `delayMs`. */
export class DiscordEventRetry extends Error {
  constructor(readonly delayMs: number) {
    super("Discord is rate-limiting the bot token.");
  }
}

/** The banner as a data URI; undefined without a banner, when its file is gone, or when it is too big for Discord. */
async function bannerDataUri(db: Db, request: EventRequestRow): Promise<string | undefined> {
  if (!request.bannerUploadId) return undefined;
  try {
    const { bytes, mime } = await readUploadForWorker(db, request.bannerUploadId);
    if (bytes.length > MAX_IMAGE_BYTES) {
      console.warn(`The banner of request ${request.id} is larger than 8 MiB; the Discord event is kept without it.`);
      return undefined;
    }
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** The event body of a request: its fields, the current brief and the banner. Null while the request has no start. */
async function payloadOf(db: Db, request: EventRequestRow): Promise<ScheduledEventBody | null> {
  if (!request.startsAt) return null;
  const [brief] =
    request.briefVersion === 0
      ? []
      : await db
          .select({ body: eventBriefVersion.body })
          .from(eventBriefVersion)
          .where(and(eq(eventBriefVersion.requestId, request.id), eq(eventBriefVersion.version, request.briefVersion)))
          .limit(1);
  return eventPayload({ ...request, brief: brief?.body ?? "" }, await bannerDataUri(db, request));
}

/** Records what Discord said to the bot token (null leaves the status and only stamps the time). */
async function recordBotStatus(db: Db, status: BotStatus | null): Promise<void> {
  await db
    .update(eventSettings)
    .set({ ...(status ? { botStatus: status } : {}), botCheckedAt: new Date() })
    .where(eq(eventSettings.id, "default"));
}

/** The bot status a refusal means: Discord's code 50013 is a missing permission, any other 401/403 a bad token. */
const refusal = (result: Extract<BotResult<unknown>, { kind: "denied" }>): BotStatus => (result.code === 50013 ? "missing-permissions" : "denied");

/** Writes one line to the request's history, without an author (the worker acts for nobody). */
async function logPost(db: Executor, requestId: string, newValue: string): Promise<void> {
  await db.insert(requestLog).values({ requestId, field: "post", oldValue: null, newValue });
}

/**
 * Makes sure the request has its Discord scheduled event before the first send of an announcement. Without a bot token or
 * guild id it does nothing (the card is the details embed). With a stored event id it returns that event's link and creates
 * nothing. Otherwise it creates the event, stores the id in its own transaction at once and logs it. A refusal never blocks the
 * post: it records the bot status, reports why through `note` and returns null. A 5xx or network error does the same.
 *
 * @returns the event's link, or null while there is no event
 * @throws DiscordEventRetry on a 429
 */
export async function ensureDiscordEvent(
  deps: WorkerDeps,
  request: EventRequestRow,
  settings: Pick<PostSettings, "guildId">,
  secrets: Pick<EventSecrets, "botToken">,
  note?: (message: string) => void,
): Promise<{ url: string } | null> {
  const { botToken } = secrets;
  const { guildId } = settings;
  if (!botToken || !guildId) return null;
  if (request.discordEventId) return { url: scheduledEventUrl(guildId, request.discordEventId) };
  const body = await payloadOf(deps.db, request);
  if (!body) return null;
  const result = await createScheduledEvent(botToken, guildId, body);
  if (result.kind === "ok") {
    const eventId = result.value.id;
    const stored = await deps.db.transaction(async (tx) => {
      const rows = await tx
        .update(eventRequest)
        .set({ discordEventId: eventId })
        .where(and(eq(eventRequest.id, request.id), isNull(eventRequest.discordEventId)))
        .returning({ id: eventRequest.id });
      if (rows.length > 0) await logPost(tx, request.id, "discord event created");
      return rows.length > 0;
    });
    await recordBotStatus(deps.db, "ok");
    if (stored) return { url: scheduledEventUrl(guildId, eventId) };
    // Another run stored an event first: this one is a duplicate, removed on a best-effort basis; the stored id is the event.
    await deleteScheduledEvent(botToken, guildId, eventId);
    const [current] = await deps.db.select({ id: eventRequest.discordEventId }).from(eventRequest).where(eq(eventRequest.id, request.id)).limit(1);
    return current?.id ? { url: scheduledEventUrl(guildId, current.id) } : null;
  }
  if (result.kind === "retry") throw new DiscordEventRetry(result.delayMs);
  if (result.kind === "failed") {
    // A server or network error never strands the announcement: it goes out with the details card.
    note?.("Discord event could not be created (Discord did not answer)");
    return null;
  }
  const status = result.kind === "denied" ? result.status : result.kind === "gone" ? 404 : result.status;
  if (result.kind === "denied") await recordBotStatus(deps.db, refusal(result));
  else await recordBotStatus(deps.db, null);
  note?.(`Discord event could not be created (${status})`);
  return null;
}

const snowflake = z.string().regex(/^\d{1,32}$/);
const jobData = z.discriminatedUnion("action", [
  z.object({ requestId: z.string().min(1), action: z.enum(["update", "delete", "create"]), retry: z.number().int().min(0).optional() }),
  z.object({ requestId: z.string().min(1), action: z.literal("delete-orphan"), guildId: snowflake, eventId: snowflake, retry: z.number().int().min(0).optional() }),
]);

/** Clears the stored event id (only while it still is `eventId`) and logs why. */
async function forget(db: Db, requestId: string, eventId: string, why: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(eventRequest).set({ discordEventId: null }).where(and(eq(eventRequest.id, requestId), eq(eventRequest.discordEventId, eventId)));
    await logPost(tx, requestId, why);
  });
}

/** The `create` action: makes the event of a reopened request with {@link ensureDiscordEvent}; a 429 queues the job again like the update path. */
async function createEvent(deps: WorkerDeps, request: EventRequestRow | undefined, retry: number): Promise<void> {
  // A request cancelled or withdrawn again before the job ran gets no public event.
  if (!request || (request.status !== "accepted" && request.status !== "event_week")) return;
  const settings = await loadPostSettings(deps.db);
  const secrets = await loadEventSecrets(deps.db);
  try {
    await ensureDiscordEvent(deps, request, settings, secrets);
  } catch (error) {
    if (!(error instanceof DiscordEventRetry)) throw error;
    const n = retry + 1;
    if (n > MAX_RETRIES) throw new Error(`Discord rate-limited the event create ${n} times in a row.`);
    await deps.queue("deliver").add("events.discord-event", { requestId: request.id, action: "create", retry: n }, { jobId: `event-dev-${request.id}-create-r${n}-${deps.now().getTime()}`, delayMs: error.delayMs, attempts: 3, backoffMs: 10_000 });
  }
}

/** The `delete-orphan` action: removes the event of a request that is gone by its ids; a 429 queues the job again like the update path. */
async function deleteOrphan(deps: WorkerDeps, data: { requestId: string; guildId: string; eventId: string; retry?: number }): Promise<void> {
  const { requestId, guildId, eventId, retry = 0 } = data;
  const { botToken } = await loadEventSecrets(deps.db);
  if (!botToken) return;
  const result = await deleteScheduledEvent(botToken, guildId, eventId);
  if (result.kind === "ok") await recordBotStatus(deps.db, "ok");
  else if (result.kind === "denied") await recordBotStatus(deps.db, refusal(result));
  else if (result.kind === "rejected") await recordBotStatus(deps.db, null);
  else if (result.kind === "retry") {
    const n = retry + 1;
    if (n > MAX_RETRIES) throw new Error(`Discord rate-limited the event delete ${n} times in a row.`);
    await deps.queue("deliver").add("events.discord-event", { requestId, action: "delete-orphan", guildId, eventId, retry: n }, { jobId: `event-dev-${requestId}-delete-orphan-r${n}-${deps.now().getTime()}`, delayMs: result.delayMs, attempts: 3, backoffMs: 10_000 });
  } else if (result.kind === "failed") throw result.error;
}

/**
 * Brings the Discord event of a request in line with it: `update` sends the current name, description, times, location and
 * banner, `delete` removes the event, `delete-orphan` removes the event of an already deleted request by its guild and event id, `create` makes it for a reopened request. An event Discord no longer has clears the stored id and stops. A refused token is
 * recorded on the settings and not retried; a 429 queues the job again after Discord's delay; a 5xx throws so BullMQ retries.
 * Nothing happens without a stored event id, a bot token or a guild id.
 */
export async function syncDiscordEvent(deps: WorkerDeps, raw: unknown): Promise<void> {
  const data = jobData.parse(raw);
  if (data.action === "delete-orphan") return deleteOrphan(deps, data);
  const { requestId, action, retry = 0 } = data;
  const [request] = await deps.db.select().from(eventRequest).where(eq(eventRequest.id, requestId)).limit(1);
  if (action === "create") return createEvent(deps, request, retry);
  if (!request?.discordEventId) return;
  const { botToken } = await loadEventSecrets(deps.db);
  const { guildId } = await loadPostSettings(deps.db);
  if (!botToken || !guildId) return;
  const eventId = request.discordEventId;
  let result: BotResult<unknown>;
  if (action === "delete") result = await deleteScheduledEvent(botToken, guildId, eventId);
  else {
    const body = await payloadOf(deps.db, request);
    if (!body) return;
    result = await updateScheduledEvent(botToken, guildId, eventId, body);
  }
  if (result.kind === "ok") {
    await recordBotStatus(deps.db, "ok");
    if (action === "delete") await forget(deps.db, requestId, eventId, "discord event deleted");
    return;
  }
  if (result.kind === "gone") {
    await forget(deps.db, requestId, eventId, action === "delete" ? "discord event deleted" : "discord event gone");
    return;
  }
  if (result.kind === "denied") {
    await recordBotStatus(deps.db, refusal(result));
    return;
  }
  if (result.kind === "rejected") {
    await recordBotStatus(deps.db, null);
    await logPost(deps.db, requestId, `discord event ${action} rejected (${result.status})`);
    return;
  }
  if (result.kind === "retry") {
    const n = retry + 1;
    if (n > MAX_RETRIES) throw new Error(`Discord rate-limited the event ${action} ${n} times in a row.`);
    await deps.queue("deliver").add("events.discord-event", { requestId, action, retry: n }, { jobId: `event-dev-${requestId}-${action}-r${n}-${deps.now().getTime()}`, delayMs: result.delayMs, attempts: 3, backoffMs: 10_000 });
    return;
  }
  throw result.error;
}

// Attempts and backoff are set where the job is enqueued (3 tries, exponential from 10 s).
registerJob(QUEUE.deliver, "events.discord-event", (data, deps) => syncDiscordEvent(deps, data));
