import type { EventRequestRow, EventSettingsRow } from "@/db/schema";
import type { ScheduledEventBody } from "./discord-bot";
import { messageProblems, splitText, textLength, LIMITS, type Embed } from "./discord-limits";
import { fillPlaceholders, placeholderValues, PLACEHOLDERS, type Placeholder } from "./event-placeholders";

/** The most characters a post text may hold: 20 messages and the card. */
export const MAX_POST_TEXT = 40_000;

/** The kinds of post a request has. */
export const POST_KINDS = ["team", "announcement", "reminder", "disaster", "resolved", "cancelled"] as const;

/** One of {@link POST_KINDS}. */
export type PostKind = (typeof POST_KINDS)[number];

/** Which webhook a kind is posted to. */
export const POST_TARGET = { team: "team", announcement: "public", reminder: "public", disaster: "public", resolved: "public", cancelled: "public" } as const satisfies Record<PostKind, "team" | "public">;

/** Days from the event start when a kind is due (display only; nothing is scheduled). */
export const POST_DUE_OFFSET_DAYS: Partial<Record<PostKind, number>> = { team: -8, announcement: -7, reminder: -1 };

/** The to-do a posted kind ticks. */
export const POST_TODO_KEY: Partial<Record<PostKind, string>> = { team: "team-message", announcement: "announcement", reminder: "reminder" };

/** One Discord message of a post; `messageId` is set the moment Discord answers. */
export interface PostPart {
  kind: "text" | "embed" | "event-link";
  /** The message content: the text chunk, the event url, or empty for an embed part. */
  content: string;
  embed?: Embed;
  uploadId?: string | null;
  messageId: string | null;
  sentAt: string | null;
  /** Set while a delete is half done: Discord no longer has this message, and the post must not send it again. */
  deleted?: true;
}

/** What {@link plannedParts} reads from a post. */
export interface PlanPost {
  kind: PostKind;
  text: string;
  embed: Embed | null;
  pingRole: boolean;
  note: string | null;
}

/** What the builders read from the settings. */
export type PlanSettings = Pick<EventSettingsRow, "pingRoleId" | "timeZone" | "rulebookUrl" | "detailsTemplate" | "disasterTemplate" | "resolvedTemplate" | "cancelledTemplate">;

/** What the builders read from the request. */
export type PlanRequest = Pick<EventRequestRow, "title" | "startsAt" | "durationMinutes" | "where" | "eventDocsUrl" | "bannerUploadId" | "summary">;

/** Fixed phrases the app writes into Discord; German because the players read them. */
export const GERMAN = {
  testMarker: "Testnachricht (nur für das Team)",
  resumed: "Dieser Beitrag wird fortgesetzt.",
} as const;

/** The location of a Discord event without a `where`. */
const GERMAN_SERVER = "Auf dem Server";

const NO_NOTE: readonly Placeholder[] = PLACEHOLDERS.filter((p) => p !== "note");

/** The details card: title and link of the event, the short description and the filled template lines, the banner as thumbnail. */
export function buildDetailsEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "detailsTemplate">): Embed {
  const values = placeholderValues(request, settings);
  const t = settings.detailsTemplate;
  const lines = t.lines.map((line) => fillPlaceholders(line, values, { allow: NO_NOTE, mode: "discord" })).join("\n");
  const summary = request.summary;
  return {
    title: request.title,
    url: request.eventDocsUrl,
    description: summary.trim() === "" ? lines : `${summary}\n\n${lines}`,
    color: t.color,
    imageUploadId: request.bannerUploadId,
    imageAs: "thumbnail",
    fields: [],
    footer: fillPlaceholders(t.footer, values, { allow: NO_NOTE, mode: "text" }),
  };
}

/** The embed of the disaster message from the settings' template; the generic image is shown as thumbnail. `{note}` is filled here; a template without it gets the note after a blank line. */
export function buildDisasterEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "disasterTemplate">, note: string | null): Embed {
  const t = settings.disasterTemplate;
  const values = placeholderValues(request, settings, note ?? "");
  const filled = fillPlaceholders(t.text, values, { allow: PLACEHOLDERS, mode: "discord" }).trimEnd();
  return {
    title: fillPlaceholders(t.title, values, { allow: PLACEHOLDERS, mode: "text" }),
    description: note && !t.text.includes("{note}") ? `${filled}

${note}` : filled,
    color: t.color,
    imageUploadId: t.imageUploadId,
    imageAs: "thumbnail",
    fields: [],
    footer: "",
  };
}

/** The embed of the resolved message; `{note}` is filled here only. It shows the disaster template's image (spec 5.2). */
export function buildResolvedEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "resolvedTemplate" | "disasterTemplate">, note: string | null): Embed {
  const t = settings.resolvedTemplate;
  const values = placeholderValues(request, settings, note ?? "");
  return {
    title: fillPlaceholders(t.title, values, { allow: PLACEHOLDERS, mode: "text" }),
    description: fillPlaceholders(t.text, values, { allow: PLACEHOLDERS, mode: "discord" }),
    color: t.color,
    imageUploadId: settings.disasterTemplate.imageUploadId,
    imageAs: "thumbnail",
    fields: [],
    footer: "",
  };
}

/** The embed of the cancelled message; `{note}` is the cancel note, left as the literal `{note}` when `note` is null. The banner is shown as thumbnail. */
export function buildCancelledEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "cancelledTemplate">, note: string | null): Embed {
  const t = settings.cancelledTemplate;
  const values = placeholderValues(request, settings, note ?? "{note}");
  return {
    title: fillPlaceholders(t.title, values, { allow: PLACEHOLDERS, mode: "text" }),
    description: fillPlaceholders(t.text, values, { allow: PLACEHOLDERS, mode: "discord" }).trimEnd(),
    color: t.color,
    imageUploadId: request.bannerUploadId,
    imageAs: "thumbnail",
    fields: [],
    footer: "",
  };
}

/** Whether a post of `kind` may carry the role ping. */
export const mayPing = (kind: PostKind, pingRole: boolean): boolean => pingRole && (kind === "announcement" || kind === "reminder");

/** Whether the first message of a stored post carries the role mention text; an edit keeps it as it is. */
export const keepsMention = (parts: PostPart[]): boolean => parts[0]?.kind === "text" && /^<@&\d+>\n/.test(parts[0].content);

/** The Discord event link of the request, once the event exists and the guild is known. */
export function discordEventUrl(request: Pick<EventRequestRow, "discordEventId">, settings: Pick<EventSettingsRow, "guildId">): string | null {
  return request.discordEventId && settings.guildId ? `https://discord.com/events/${settings.guildId}/${request.discordEventId}` : null;
}

const unsent = (fields: Pick<PostPart, "kind" | "content"> & Partial<PostPart>): PostPart => ({ messageId: null, sentAt: null, ...fields });

/**
 * Plans the Discord messages of a post. The text becomes `text` parts; the last part is its own message: the event link when
 * the Discord event exists, else the details embed (an explicit `post.embed` replaces it). A team notice always ends with the details embed (never the event link); disaster, resolved and cancelled posts are the embed from their template. The role mention is written only
 * into the first part of an announcement or a chosen reminder, and the first chunk shrinks to leave room for it.
 *
 * @throws Error naming the part whose message Discord would refuse
 */
export function plannedParts(post: PlanPost, request: PlanRequest, settings: PlanSettings, opts: { discordEventUrl: string | null }): PostPart[] {
  const mention = mayPing(post.kind, post.pingRole) && settings.pingRoleId ? `<@&${settings.pingRoleId}>\n` : "";
  const text = fillPlaceholders(post.text, placeholderValues(request, settings), { allow: NO_NOTE, mode: "discord" });
  const chunks = splitText(text, LIMITS.content, LIMITS.content - textLength(mention));
  const parts: PostPart[] = chunks.map((c, i) => unsent({ kind: "text", content: i === 0 ? mention + c : c }));
  if (post.kind === "disaster" || post.kind === "resolved" || post.kind === "cancelled") {
    const embed = post.embed ?? (post.kind === "disaster" ? buildDisasterEmbed(request, settings, post.note) : post.kind === "resolved" ? buildResolvedEmbed(request, settings, post.note) : buildCancelledEmbed(request, settings, post.note));
    parts.push(unsent({ kind: "embed", content: "", embed, uploadId: embed.imageUploadId }));
  } else if (post.embed) {
    parts.push(unsent({ kind: "embed", content: "", embed: post.embed, uploadId: post.embed.imageUploadId }));
  } else {
    if (opts.discordEventUrl && post.kind !== "team") parts.push(unsent({ kind: "event-link", content: opts.discordEventUrl }));
    else {
      const embed = buildDetailsEmbed(request, settings);
      parts.push(unsent({ kind: "embed", content: "", embed, uploadId: embed.imageUploadId }));
    }
  }
  parts.forEach((part, i) => {
    const problems = messageProblems({ content: part.content, embeds: part.embed ? [part.embed] : [] });
    if (problems.length > 0) throw new Error(`Message part ${i + 1} does not fit Discord: ${problems.join("; ")}.`);
  });
  return parts;
}

/** What the Discord event of a request is built from: the request's fields and its brief. */
export type PayloadRequest = Pick<EventRequestRow, "title" | "startsAt" | "durationMinutes" | "where" | "eventDocsUrl"> & { summary: string; brief: string };

const EVENT_NAME_MAX = 100;
const EVENT_DESCRIPTION_MAX = 1000;
const EVENT_BRIEF_MAX = 700;
const DEFAULT_DURATION_MINUTES = 120;

/** `text` cut to `max` code points, ending with `…` when it was cut. */
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** The first paragraph of a brief that is more than a heading; empty for an empty brief. */
function firstParagraph(brief: string): string {
  const paragraphs = brief.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  return paragraphs.find((p) => !/^#{1,6}\s/.test(p)) ?? paragraphs[0]?.replace(/^#{1,6}\s+/, "") ?? "";
}

/**
 * The Discord scheduled event of a request. The description is the short description, else the brief's first paragraph (at most 700 characters) and,
 * when the request has an event docs url, a final German `Infos:` line with it; the whole stays within Discord's 1,000. A
 * request without a start has no event: the caller checks `startsAt` first.
 *
 * @throws Error when the request has no start
 */
export function eventPayload(request: PayloadRequest, imageDataUri?: string): ScheduledEventBody {
  if (!request.startsAt) throw new Error("A request without a start date has no Discord event.");
  const infos = request.eventDocsUrl ? `Infos: ${request.eventDocsUrl}` : "";
  const room = EVENT_DESCRIPTION_MAX - (infos ? textLength(infos) + 2 : 0);
  const lead = cut(request.summary.trim() || firstParagraph(request.brief), Math.min(EVENT_BRIEF_MAX, room));
  return {
    name: cut(request.title, EVENT_NAME_MAX),
    description: [lead, infos].filter((part) => part !== "").join("\n\n"),
    startsAt: request.startsAt,
    endsAt: new Date(request.startsAt.getTime() + (request.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000),
    location: request.where.trim() || GERMAN_SERVER,
    ...(imageDataUri ? { imageDataUri } : {}),
  };
}
