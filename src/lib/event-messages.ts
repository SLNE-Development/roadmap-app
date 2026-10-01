import type { EventRequestRow, EventSettingsRow } from "@/db/schema";
import { messageProblems, splitText, textLength, LIMITS, type Embed } from "./discord-limits";
import { fillPlaceholders, placeholderValues, PLACEHOLDERS, type Placeholder } from "./event-placeholders";

/** The kinds of post a request has. */
export const POST_KINDS = ["team", "announcement", "reminder", "disaster", "resolved"] as const;

/** One of {@link POST_KINDS}. */
export type PostKind = (typeof POST_KINDS)[number];

/** Which webhook a kind is posted to. */
export const POST_TARGET = { team: "team", announcement: "public", reminder: "public", disaster: "public", resolved: "public" } as const satisfies Record<PostKind, "team" | "public">;

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
export type PlanSettings = Pick<EventSettingsRow, "pingRoleId" | "timeZone" | "rulebookUrl" | "detailsTemplate" | "disasterTemplate" | "resolvedTemplate">;

type PlanRequest = Pick<EventRequestRow, "title" | "startsAt" | "durationMinutes" | "where" | "eventDocsUrl" | "bannerUploadId">;

/** Fixed phrases the app writes into Discord; German because the players read them. */
export const GERMAN = {
  testMarker: "Testnachricht (nur für das Team)",
  resumed: "Dieser Beitrag wird fortgesetzt.",
  /** The reply under a resolved disaster message. */
  backOnline: (event: string): string => `${event} ist wieder online.`,
} as const;

const NO_NOTE: readonly Placeholder[] = PLACEHOLDERS.filter((p) => p !== "note");

/** The details card: title and link of the event, the filled template lines, the banner as image. */
export function buildDetailsEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "detailsTemplate">, now?: Date): Embed {
  const values = placeholderValues(request, settings, now);
  const fill = (text: string) => fillPlaceholders(text, values, { allow: NO_NOTE });
  const t = settings.detailsTemplate;
  return {
    title: request.title,
    url: request.eventDocsUrl,
    description: t.lines.map(fill).join("\n"),
    color: t.color,
    imageUploadId: request.bannerUploadId,
    fields: [],
    footer: fill(t.footer),
  };
}

/** The embed of the disaster message from the settings' template. */
export function buildDisasterEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "disasterTemplate">, now?: Date): Embed {
  const t = settings.disasterTemplate;
  const values = placeholderValues(request, settings, now);
  const fill = (text: string) => fillPlaceholders(text, values, { allow: NO_NOTE });
  return { title: fill(t.title), description: fill(t.text), color: t.color, imageUploadId: t.imageUploadId, fields: [], footer: "" };
}

/** The embed of the resolved message; `{note}` is filled here only. */
export function buildResolvedEmbed(request: PlanRequest, settings: Pick<PlanSettings, "timeZone" | "rulebookUrl" | "resolvedTemplate">, note: string | null, now?: Date): Embed {
  const t = settings.resolvedTemplate;
  const values = placeholderValues(request, settings, now, note ?? "");
  const fill = (text: string) => fillPlaceholders(text, values, { allow: PLACEHOLDERS });
  return { title: fill(t.title), description: fill(t.text), color: t.color, imageUploadId: t.imageUploadId, fields: [], footer: "" };
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
 * the Discord event exists, else the details embed (an explicit `post.embed` replaces it). A team notice always ends with the details embed (never the event link); disaster and resolved posts are the embed from their template. The role mention is written only
 * into the first part of an announcement or a chosen reminder, and the first chunk shrinks to leave room for it.
 *
 * @throws Error naming the part whose message Discord would refuse
 */
export function plannedParts(post: PlanPost, request: PlanRequest, settings: PlanSettings, opts: { discordEventUrl: string | null }): PostPart[] {
  const mention = mayPing(post.kind, post.pingRole) && settings.pingRoleId ? `<@&${settings.pingRoleId}>\n` : "";
  const text = fillPlaceholders(post.text, placeholderValues(request, settings), { allow: NO_NOTE });
  const chunks = splitText(text, LIMITS.content, LIMITS.content - textLength(mention));
  const parts: PostPart[] = chunks.map((c, i) => unsent({ kind: "text", content: i === 0 ? mention + c : c }));
  if (post.kind === "disaster" || post.kind === "resolved") {
    const embed = post.embed ?? (post.kind === "disaster" ? buildDisasterEmbed(request, settings) : buildResolvedEmbed(request, settings, post.note));
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
