import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { board, projectWebhook } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { encryptSecret } from "@/lib/crypto";
import { DISCORD_EVENTS } from "@/lib/discord-events";
import { newId } from "@/lib/id";
import { timeZoneSchema } from "@/lib/notify-rules-schema";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";

/** The webhook URLs Discord hands out, on any of its hosts. */
const DISCORD_WEBHOOK_URL = /^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

/** The webhook fields without defaults. Each carries a message that reads on its own, since errors drop the field path. */
const webhookFields = z.object({
  name: z.string().trim().min(1, "Give the webhook a name.").max(64, "Keep the name to 64 characters."),
  url: z.string().trim().regex(DISCORD_WEBHOOK_URL, "Use a Discord webhook URL from Channel settings → Integrations → Webhooks."),
  events: z.array(z.enum(DISCORD_EVENTS, "Unknown event.")).min(1, "Pick at least one event."),
  boardIds: z.array(z.string().min(1).max(64)).max(100),
  digest: z.boolean(),
  timeZone: timeZoneSchema,
});

/** Input of {@link createWebhook}; without boards it posts about all of them. */
export const webhookInput = webhookFields.extend({
  boardIds: webhookFields.shape.boardIds.default([]),
  digest: webhookFields.shape.digest.default(false),
  timeZone: webhookFields.shape.timeZone.default("UTC"),
});

/** Input of {@link updateWebhook}; omitted fields stay unchanged, a `url` replaces the stored one. */
export const updateWebhookInput = webhookFields.partial().extend({ enabled: z.boolean().optional() });

/** A webhook as owners see it: never the URL, only the last 4 characters of its token. */
export interface WebhookItem {
  id: string;
  name: string;
  urlHint: string;
  events: string[];
  boardIds: string[];
  digest: boolean;
  timeZone: string;
  enabled: boolean;
  disabledReason: string | null;
  lastSentAt: Date | null;
  lastDigestAt: Date | null;
  createdAt: Date;
}

/**
 * Parses `raw` with `schema`, turning a failure into an InvalidError with the issue messages.
 *
 * @throws InvalidError when the input does not match
 */
function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new InvalidError(result.error.issues.map((i) => i.message).join(" "));
  return result.data;
}

/** The URL encrypted, plus the hint the settings show. */
function storedUrl(url: string): { urlEnc: string; urlHint: string } {
  return { urlEnc: encryptSecret(url), urlHint: url.slice(-4) };
}

/** Events in `DISCORD_EVENTS` order without repeats. */
function orderedEvents(events: readonly string[]): string[] {
  return DISCORD_EVENTS.filter((e) => events.includes(e));
}

/** The project's boards among `ids`, in board order. */
function boardsAmong(tx: Executor, projectId: string, ids: readonly string[]) {
  return tx
    .select({ id: board.id, name: board.name })
    .from(board)
    .where(and(eq(board.projectId, projectId), inArray(board.id, [...ids])))
    .orderBy(asc(board.sortOrder), asc(board.id));
}

/**
 * Checks that every id names a board of the project and returns the ids with the boards' names, in board order.
 *
 * @throws InvalidError naming an unknown id
 */
async function projectBoards(tx: Executor, projectId: string, ids: readonly string[]): Promise<{ ids: string[]; names: string[] }> {
  if (ids.length === 0) return { ids: [], names: [] };
  const rows = await boardsAmong(tx, projectId, ids);
  const unknown = ids.find((id) => !rows.some((r) => r.id === id));
  if (unknown !== undefined) throw new InvalidError(`Unknown board ${unknown} in this project.`);
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

/** The logged value of a board selection. */
function boardsValue(names: readonly string[]): string {
  return names.length === 0 ? "All boards" : names.join(", ");
}

/**
 * Loads a webhook of the project.
 *
 * @throws NotFoundError if the project has no such webhook
 */
async function findWebhook(tx: Executor, projectId: string, id: string) {
  const [row] = await tx
    .select()
    .from(projectWebhook)
    .where(and(eq(projectWebhook.id, id), eq(projectWebhook.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError(`Unknown webhook ${id}.`);
  return row;
}

/** Lists the project's Discord webhooks, oldest first, without their URLs. Owner or higher, also on an archived project. */
export async function listWebhooks(db: Executor, actor: Actor, projectSlug: string): Promise<WebhookItem[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "owner", { allowArchived: true });
  return db
    .select({
      id: projectWebhook.id,
      name: projectWebhook.name,
      urlHint: projectWebhook.urlHint,
      events: projectWebhook.events,
      boardIds: projectWebhook.boardIds,
      digest: projectWebhook.digest,
      timeZone: projectWebhook.timeZone,
      enabled: projectWebhook.enabled,
      disabledReason: projectWebhook.disabledReason,
      lastSentAt: projectWebhook.lastSentAt,
      lastDigestAt: projectWebhook.lastDigestAt,
      createdAt: projectWebhook.createdAt,
    })
    .from(projectWebhook)
    .where(eq(projectWebhook.projectId, project.id))
    .orderBy(asc(projectWebhook.createdAt), asc(projectWebhook.id));
}

/**
 * Adds a Discord webhook to the project, storing its URL encrypted, and logs it by name. Owner or higher.
 *
 * @throws InvalidError for a URL that is not a Discord webhook, no events, an unknown time zone or a board of another project
 */
export async function createWebhook(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof webhookInput>): Promise<{ id: string }> {
  const input = parse(webhookInput, raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const boards = await projectBoards(tx, project.id, input.boardIds);
    const id = newId();
    await tx.insert(projectWebhook).values({
      id,
      projectId: project.id,
      name: input.name,
      ...storedUrl(input.url),
      events: orderedEvents(input.events),
      boardIds: boards.ids,
      digest: input.digest,
      timeZone: input.timeZone,
      createdBy: actor.userId,
    });
    await logChange(tx, actor, { projectId: project.id, entity: "webhook", entityId: id, field: "created", newValue: input.name });
    return { id };
  });
}

/**
 * Changes a webhook: a new `url` replaces the stored one, and enabling it clears the reason it was turned off.
 * Logs changes to its events, boards and enabled state, never the URL. Owner or higher.
 *
 * @throws NotFoundError if the project has no such webhook
 * @throws InvalidError for invalid fields, as in {@link createWebhook}
 */
export async function updateWebhook(
  db: Db,
  actor: Actor,
  projectSlug: string,
  id: string,
  raw: z.input<typeof updateWebhookInput>,
): Promise<void> {
  const patch = parse(updateWebhookInput, raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const existing = await findWebhook(tx, project.id, id);
    const entry = { projectId: project.id, entity: "webhook", entityId: id };
    const set: Partial<typeof projectWebhook.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.url !== undefined) Object.assign(set, storedUrl(patch.url));
    if (patch.digest !== undefined) set.digest = patch.digest;
    if (patch.timeZone !== undefined) set.timeZone = patch.timeZone;
    if (patch.events !== undefined) {
      const events = orderedEvents(patch.events);
      if (events.join() !== existing.events.join()) {
        set.events = events;
        await logChange(tx, actor, { ...entry, field: "events", oldValue: existing.events.join(", "), newValue: events.join(", ") });
      }
    }
    if (patch.boardIds !== undefined) {
      const next = await projectBoards(tx, project.id, patch.boardIds);
      if (next.ids.join() !== existing.boardIds.join()) {
        // Boards deleted since drop out of the old names.
        const old = existing.boardIds.length === 0 ? [] : await boardsAmong(tx, project.id, existing.boardIds);
        set.boardIds = next.ids;
        await logChange(tx, actor, { ...entry, field: "boards", oldValue: boardsValue(old.map((b) => b.name)), newValue: boardsValue(next.names) });
      }
    }
    if (patch.enabled !== undefined) {
      if (patch.enabled) set.disabledReason = null;
      if (patch.enabled !== existing.enabled) {
        set.enabled = patch.enabled;
        await logChange(tx, actor, { ...entry, field: "enabled", oldValue: String(existing.enabled), newValue: String(patch.enabled) });
      }
    }
    if (Object.keys(set).length > 0) await tx.update(projectWebhook).set(set).where(eq(projectWebhook.id, id));
  });
}

/**
 * Deletes a webhook with its pending messages and logs it by name. Owner or higher.
 *
 * @throws NotFoundError if the project has no such webhook
 */
export async function deleteWebhook(db: Db, actor: Actor, projectSlug: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const existing = await findWebhook(tx, project.id, id);
    await tx.delete(projectWebhook).where(eq(projectWebhook.id, id));
    await logChange(tx, actor, { projectId: project.id, entity: "webhook", entityId: id, field: "deleted", oldValue: existing.name });
  });
}

/**
 * Queues a test message to the webhook (`discord.test` on the deliver queue). Repeated clicks within the same minute
 * collapse into one job. Owner or higher.
 *
 * @param queue the deliver queue
 * @throws NotFoundError if the project has no such webhook
 * @throws ConflictError if the job queue cannot be reached
 */
export async function sendTestMessage(db: Executor, actor: Actor, projectSlug: string, id: string, queue: JobQueue): Promise<void> {
  const { project } = await projectAccess(db, actor, projectSlug, "owner");
  await findWebhook(db, project.id, id);
  const minute = Math.floor(Date.now() / 60_000);
  try {
    await addWithTimeout(queue, "discord.test", { webhookId: id }, { jobId: `discord-test-${id}-${minute}` });
  } catch (error) {
    console.error(error);
    throw new ConflictError("Background jobs are unavailable right now, so the test message was not sent. Try again in a minute.");
  }
}
