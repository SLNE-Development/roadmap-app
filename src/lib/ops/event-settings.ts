import { eq } from "drizzle-orm";
import { z } from "zod";
import { eventSettings, eventUpload, type BotStatus, type EventRequestRow, type EventSettingsRow } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { encryptSecret } from "@/lib/crypto";
import { scheduledEventUrl } from "@/lib/discord-bot";
import { fillPlaceholders, placeholderValues, PLACEHOLDERS, type FillMode, type Placeholder } from "@/lib/event-placeholders";
import { DEFAULT_EVENT_TIME_ZONE } from "@/lib/event-prep-template";
import { detailsTemplateSchema, embedTemplateSchema, type DetailsTemplate, type EmbedTemplate } from "@/lib/event-templates";
import { timeZoneSchema } from "@/lib/notify-rules-schema";
import type { Actor } from "./actor";
import { ForbiddenError, InvalidError } from "./errors";
import { eventFlags, requireEventManager } from "./request-access";
import { DISCORD_WEBHOOK_URL, DISCORD_WEBHOOK_URL_MESSAGE } from "./webhooks";

/** The id of the one settings row. */
const SETTINGS_ID = "default";

/** Whether a secret is stored, and the masked end of it (`••••abcd`); never the value. */
export interface SecretState {
  set: boolean;
  hint: string | null;
}

/** The settings as the page sees them: managed fields in full, secrets only as {@link SecretState}. It has no property that could hold a secret. */
export interface EventSettingsView {
  postAs: string;
  pingRoleId: string | null;
  guildId: string | null;
  timeZone: string;
  rulebookUrl: string | null;
  announcementStyle: string;
  announcementExample: string;
  reminderExample: string;
  teamStyle: string;
  teamExample: string;
  disasterTemplate: EmbedTemplate;
  resolvedTemplate: EmbedTemplate;
  detailsTemplate: DetailsTemplate;
  updatedAt: Date;
  /** What Discord last said to the bot token, and when; null until the first call. */
  botStatus: BotStatus | null;
  botCheckedAt: Date | null;
  secrets: { publicWebhook: SecretState; teamWebhook: SecretState; staffWebhook: SecretState; botToken: SecretState };
}

/**
 * Parses `raw` with `schema`, turning a failure into an InvalidError with the issue messages. The messages never
 * hold the rejected value.
 */
function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new InvalidError(result.error.issues.map((i) => i.message).join(" "));
  return result.data;
}

const digits = (min: number, max: number) => z.string().regex(new RegExp(`^\\d{${min},${max}}$`), `Use the numeric id, ${min} to ${max} digits.`);
const longText = z.string().max(20_000);

/** Input of {@link updateEventSettings}: the managed fields, all optional. Strict, so a secret key is refused by name. */
export const updateEventSettingsInput = z.strictObject({
  postAs: z.string().trim().min(1, "Give the post-as name.").max(80),
  pingRoleId: digits(15, 21).nullable(),
  guildId: digits(1, 25).nullable(),
  timeZone: timeZoneSchema,
  rulebookUrl: z.string().trim().max(2000).regex(/^https:\/\/\S+$/, "Use an https link.").nullable(),
  announcementStyle: longText,
  announcementExample: longText,
  reminderExample: longText,
  teamStyle: longText,
  teamExample: longText,
  disasterTemplate: embedTemplateSchema,
  resolvedTemplate: embedTemplateSchema,
  detailsTemplate: detailsTemplateSchema,
}).partial();

/** Input of {@link setEventSecrets}; an omitted key stays, `null` clears. */
export const setEventSecretsInput = z.strictObject({
  publicWebhook: z.string().trim().regex(DISCORD_WEBHOOK_URL, DISCORD_WEBHOOK_URL_MESSAGE).nullable(),
  teamWebhook: z.string().trim().regex(DISCORD_WEBHOOK_URL, DISCORD_WEBHOOK_URL_MESSAGE).nullable(),
  staffWebhook: z.string().trim().regex(DISCORD_WEBHOOK_URL, DISCORD_WEBHOOK_URL_MESSAGE).nullable(),
  botToken: z.string().regex(/^[\w.-]{50,100}$/, "Use the bot token from the Discord developer portal, without spaces.").nullable(),
}).partial();

/** Input of {@link previewTemplate}. */
export const previewTemplateInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["disaster", "resolved"]), template: embedTemplateSchema }),
  z.object({ kind: z.literal("details"), template: detailsTemplateSchema }),
]);

/** A template rendered with a sample request. */
export type TemplatePreview =
  | { kind: "embed"; title: string; text: string; color: string; imageUploadId: string | null }
  | { kind: "details"; lines: string[]; color: string; footer: string };

/** Creates the settings row with its defaults when it does not exist yet, and returns it. */
async function ensureSettings(db: Executor): Promise<EventSettingsRow> {
  await db.insert(eventSettings).values({ id: SETTINGS_ID }).onConflictDoNothing();
  const [row] = await db.select().from(eventSettings).where(eq(eventSettings.id, SETTINGS_ID)).limit(1);
  return row;
}

/** The time zone event dates are planned in: the settings', or the default while there is no row. */
export async function eventTimeZone(db: Executor): Promise<string> {
  const [row] = await db.select({ timeZone: eventSettings.timeZone }).from(eventSettings).where(eq(eventSettings.id, SETTINGS_ID)).limit(1);
  return row?.timeZone ?? DEFAULT_EVENT_TIME_ZONE;
}

/** The settings a post is planned and sent with: no secret, only which webhooks are set. */
export interface PostSettings extends Pick<EventSettingsRow, "postAs" | "pingRoleId" | "guildId" | "timeZone" | "rulebookUrl" | "detailsTemplate" | "disasterTemplate" | "resolvedTemplate"> {
  hooks: { public: boolean; team: boolean; staff: boolean };
}

/**
 * Reads what posting needs from the settings (creating the row on first read), for ops and the worker. Unlike
 * {@link getEventSettings} it checks no role (a requester posts their own request); it returns only whether each webhook
 * is set, never a value or a hint.
 */
export async function loadPostSettings(db: Executor): Promise<PostSettings> {
  const r = await ensureSettings(db);
  return {
    postAs: r.postAs,
    pingRoleId: r.pingRoleId,
    guildId: r.guildId,
    timeZone: r.timeZone,
    rulebookUrl: r.rulebookUrl,
    detailsTemplate: r.detailsTemplate,
    disasterTemplate: r.disasterTemplate,
    resolvedTemplate: r.resolvedTemplate,
    hooks: { public: r.publicWebhookEnc !== null, team: r.teamWebhookEnc !== null, staff: r.staffWebhookEnc !== null },
  };
}

/**
 * Whether Discord events can be kept in sync: a bot token and a guild id are both set. Reads only whether the token is
 * stored, never the token.
 */
export async function botConfigured(db: Executor): Promise<boolean> {
  const [row] = await db.select({ token: eventSettings.botTokenEnc, guildId: eventSettings.guildId }).from(eventSettings).where(eq(eventSettings.id, SETTINGS_ID)).limit(1);
  return row?.token != null && row.guildId != null;
}

/** Where the Discord event of a request stands, for its page: the link once it exists, else why there is none. */
export interface DiscordEventState {
  url: string | null;
  reason: "created" | "no-token" | "no-guild" | "not-yet";
}

/** Reads the state of a request's Discord event; reads only whether a token is stored, never the token. */
export async function discordEventState(db: Executor, request: Pick<EventRequestRow, "discordEventId">): Promise<DiscordEventState> {
  const [row] = await db.select({ token: eventSettings.botTokenEnc, guildId: eventSettings.guildId }).from(eventSettings).where(eq(eventSettings.id, SETTINGS_ID)).limit(1);
  if (request.discordEventId && row?.guildId) return { url: scheduledEventUrl(row.guildId, request.discordEventId), reason: "created" };
  if (row?.token == null) return { url: null, reason: "no-token" };
  if (row.guildId == null) return { url: null, reason: "no-guild" };
  return { url: null, reason: "not-yet" };
}

/** Whether the actor holds an event role (manager, developer) or is an admin. */
async function requireReader(db: Executor, actor: Actor): Promise<void> {
  const flags = await eventFlags(db, actor);
  if (!flags.isAdmin && !flags.isEventManager && !flags.isEventDeveloper) throw new ForbiddenError("This needs an event role.");
}

const state = (enc: string | null, hint: string | null): SecretState => ({ set: enc !== null, hint: enc !== null && hint ? `••••${hint}` : null });

/**
 * Reads the settings (creating the row on first read). Event managers, developers and admins may read; secrets show
 * only whether they are set and their last four characters.
 *
 * @throws ForbiddenError for everyone else
 */
export async function getEventSettings(db: Db, actor: Actor): Promise<EventSettingsView> {
  await requireReader(db, actor);
  const r = await ensureSettings(db);
  return {
    postAs: r.postAs,
    pingRoleId: r.pingRoleId,
    guildId: r.guildId,
    timeZone: r.timeZone,
    rulebookUrl: r.rulebookUrl,
    announcementStyle: r.announcementStyle,
    announcementExample: r.announcementExample,
    reminderExample: r.reminderExample,
    teamStyle: r.teamStyle,
    teamExample: r.teamExample,
    disasterTemplate: r.disasterTemplate,
    resolvedTemplate: r.resolvedTemplate,
    detailsTemplate: r.detailsTemplate,
    updatedAt: r.updatedAt,
    botStatus: r.botStatus,
    botCheckedAt: r.botCheckedAt,
    secrets: {
      publicWebhook: state(r.publicWebhookEnc, r.publicWebhookHint),
      teamWebhook: state(r.teamWebhookEnc, r.teamWebhookHint),
      staffWebhook: state(r.staffWebhookEnc, r.staffWebhookHint),
      botToken: state(r.botTokenEnc, r.botTokenHint),
    },
  };
}

/**
 * Changes the managed settings. Records only who and when on the row and logs the names of the changed fields, never
 * their values. A template image must be a settings image (a template upload).
 *
 * @throws ForbiddenError unless the actor is an event manager or admin, InvalidError for a bad value or any other key
 */
export async function updateEventSettings(db: Db, actor: Actor, raw: unknown): Promise<void> {
  requireEventManager(await eventFlags(db, actor));
  const input = parse(updateEventSettingsInput, raw);
  const changed = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
  if (changed.length === 0) return;
  await db.transaction(async (tx) => {
    for (const template of [input.disasterTemplate, input.resolvedTemplate]) {
      if (!template?.imageUploadId) continue;
      const [upload] = await tx.select({ requestId: eventUpload.requestId, purpose: eventUpload.purpose }).from(eventUpload).where(eq(eventUpload.id, template.imageUploadId)).limit(1);
      if (!upload || upload.requestId !== null || upload.purpose !== "template") throw new InvalidError("Unknown settings image.");
    }
    await ensureSettings(tx);
    await tx.update(eventSettings).set({ ...input, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(eventSettings.id, SETTINGS_ID));
  });
  console.info(`event settings changed by ${actor.userId}: ${changed.join(", ")}`);
}

/**
 * Sets or clears webhook URLs and the bot token. Admins only. The values are encrypted before they are stored, the
 * last four characters are kept as the hint, and neither the value nor the URL appears in a log line or an error.
 *
 * @throws ForbiddenError for a non-admin (event managers included), InvalidError for a malformed value
 */
export async function setEventSecrets(db: Db, actor: Actor, raw: unknown): Promise<void> {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can change event secrets.");
  const input = parse(setEventSecretsInput, raw);
  const patch: Partial<typeof eventSettings.$inferInsert> = {};
  const columns = {
    publicWebhook: ["publicWebhookEnc", "publicWebhookHint"],
    teamWebhook: ["teamWebhookEnc", "teamWebhookHint"],
    staffWebhook: ["staffWebhookEnc", "staffWebhookHint"],
    botToken: ["botTokenEnc", "botTokenHint"],
  } as const;
  const changed: string[] = [];
  for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
    const value = input[key];
    if (value === undefined) continue;
    const [enc, hint] = columns[key];
    patch[enc] = value === null ? null : encryptSecret(value);
    patch[hint] = value === null ? null : value.slice(-4);
    changed.push(key);
  }
  if (changed.length === 0) return;
  await db.transaction(async (tx) => {
    await ensureSettings(tx);
    await tx.update(eventSettings).set({ ...patch, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(eventSettings.id, SETTINGS_ID));
  });
  console.info(`event secrets changed by ${actor.userId}: ${changed.join(", ")}`);
}

/** The event the previews are rendered for. */
const SAMPLE_REQUEST = {
  title: "Piratenfest",
  startsAt: new Date("2026-10-17T18:00:00Z"),
  durationMinutes: 90,
  where: "Hafenwelt",
  eventDocsUrl: "https://example.com/infos",
};
const SAMPLE_NOTE = "Der Server wurde neu gestartet.";

/**
 * Renders a template with a sample event and the saved time zone and rulebook link, for the editor preview. `{note}`
 * is filled in the disaster and resolved templates. Nothing is sent anywhere.
 *
 * @throws ForbiddenError without an event role, InvalidError for a template of the wrong shape
 */
export async function previewTemplate(db: Db, actor: Actor, raw: unknown): Promise<TemplatePreview> {
  await requireReader(db, actor);
  const input = parse(previewTemplateInput, raw);
  const settings = await ensureSettings(db);
  const values = placeholderValues(SAMPLE_REQUEST, settings, SAMPLE_NOTE);
  const allow: readonly Placeholder[] = input.kind === "details" ? PLACEHOLDERS.filter((p) => p !== "note") : PLACEHOLDERS;
  const fill = (text: string, mode: FillMode) => fillPlaceholders(text, values, { allow, mode });
  if (input.kind === "details") return { kind: "details", lines: input.template.lines.map((line) => fill(line, "discord")), color: input.template.color, footer: fill(input.template.footer, "text") };
  const { title, text, color, imageUploadId } = input.template;
  return { kind: "embed", title: fill(title, "text"), text: fill(text, "discord"), color, imageUploadId };
}
