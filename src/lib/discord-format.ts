import type { DiscordEvent } from "@/lib/discord-events";
import { mentionsToPlain } from "@/lib/mentions";

/** One change to post to a Discord webhook, as stored in `discord_outbox.payload`. */
export interface DiscordItem {
  event: DiscordEvent;
  projectName: string;
  projectSlug: string;
  /** The slug of the system it concerns; items of one system collapse when there are many. */
  systemSlug?: string;
  title: string;
  detail: string;
  /** An absolute URL built from `siteUrl()`. */
  href: string;
  actorName: string | null;
  /** When it happened, as an ISO timestamp. */
  at: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
  fields?: { name: string; value: string }[];
}

/** A webhook message body; `allowed_mentions` keeps any text from pinging a Discord user or role. */
export interface DiscordMessage {
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: [] };
}

/** A message and the indexes of the items it posts. */
export interface DiscordBatch {
  message: DiscordMessage;
  items: number[];
}

/** What the weekly digest reports, each list already limited to what the webhook covers. */
export interface DigestData {
  projectName: string;
  /** The absolute URL of the project. */
  href: string;
  /** Systems moved into a done column this week. */
  shipped: string[];
  /** Systems moved into an active column this week. */
  started: string[];
  /** Systems in a blocked column now. */
  blocked: string[];
  /** Unresolved questions. */
  questions: { title: string; blocking: boolean }[];
  /** Decisions accepted this week. */
  accepted: string[];
}

const EMBEDS_PER_MESSAGE = 10;
const COLLAPSE_AFTER = 10;
const COLLAPSED_LINES = 5;
const DIGEST_LINES = 10;
const TITLE_LENGTH = 256;
const TEXT_LENGTH = 1024;
/** Discord's limit on the text of all embeds of one message together. */
const MESSAGE_LENGTH = 6000;

const COLOR = { done: 0x1a7048, blocked: 0xc23636, planning: 0x6a4bd0, adr: 0x8a5a00, default: 0x0e7c86 };

/** Returns `text` as plain text (mention tokens as `@Name`) of at most `max` characters, ending with `…` when cut. */
function clip(text: string, max: number): string {
  const plain = mentionsToPlain(text);
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function colorOf(event: DiscordEvent): number {
  if (event === "system.done") return COLOR.done;
  if (event === "system.blocked") return COLOR.blocked;
  if (event === "planning.completed") return COLOR.planning;
  if (event.startsWith("adr.")) return COLOR.adr;
  return COLOR.default;
}

function footer(projectName: string, actorName: string | null): { text: string } {
  return { text: clip(actorName ? `${projectName} · ${actorName}` : projectName, 2048) };
}

/** Lists up to `max` lines as bullets, then "and N more". */
function bullets(lines: string[], max: number): string {
  const shown = lines.slice(0, max).map((line) => `• ${line}`);
  if (lines.length > max) shown.push(`and ${lines.length - max} more`);
  return shown.join("\n");
}

/** The characters of an embed that count towards Discord's limit for the embeds of one message. */
function embedLength(embed: DiscordEmbed): number {
  const fields = (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields;
}

function itemEmbed(item: DiscordItem): DiscordEmbed {
  return {
    title: clip(item.title, TITLE_LENGTH),
    ...(item.detail ? { description: clip(item.detail, TEXT_LENGTH) } : {}),
    url: item.href,
    color: colorOf(item.event),
    footer: footer(item.projectName, item.actorName),
    timestamp: item.at,
  };
}

/** One embed for many changes of a system, listing the first few. */
function collapsedEmbed(items: DiscordItem[], systemSlug: string): DiscordEmbed {
  const [first] = items;
  const last = items[items.length - 1];
  const actors = new Set(items.map((i) => i.actorName));
  return {
    title: clip(`${items.length} changes on ${systemSlug}`, TITLE_LENGTH),
    description: clip(bullets(items.map((i) => mentionsToPlain(i.title)), COLLAPSED_LINES), TEXT_LENGTH),
    url: new URL(`/p/${first.projectSlug}/systems/${systemSlug}`, first.href).href,
    color: COLOR.default,
    footer: footer(first.projectName, actors.size === 1 ? first.actorName : null),
    timestamp: last.at,
  };
}

/**
 * Turns items into webhook messages of up to 10 embeds and 6000 characters of embed text, one embed per item, in item
 * order. More than 10 items of one system collapse into one embed at the place of the first.
 */
export function buildDiscordBatches(items: DiscordItem[]): DiscordBatch[] {
  const bySystem = new Map<string, number[]>();
  items.forEach((item, idx) => {
    if (item.systemSlug) bySystem.set(item.systemSlug, [...(bySystem.get(item.systemSlug) ?? []), idx]);
  });
  const embeds: { embed: DiscordEmbed; items: number[] }[] = [];
  const done = new Set<string>();
  items.forEach((item, idx) => {
    const group = item.systemSlug ? (bySystem.get(item.systemSlug) ?? []) : [];
    if (item.systemSlug && group.length > COLLAPSE_AFTER) {
      if (done.has(item.systemSlug)) return;
      done.add(item.systemSlug);
      embeds.push({ embed: collapsedEmbed(group.map((i) => items[i]), item.systemSlug), items: group });
    } else {
      embeds.push({ embed: itemEmbed(item), items: [idx] });
    }
  });
  const chunks: (typeof embeds)[] = [];
  let size = 0;
  for (const entry of embeds) {
    const current = chunks.at(-1);
    const length = embedLength(entry.embed);
    if (!current || current.length === EMBEDS_PER_MESSAGE || size + length > MESSAGE_LENGTH) {
      chunks.push([entry]);
      size = length;
    } else {
      current.push(entry);
      size += length;
    }
  }
  return chunks.map((chunk) => ({ message: { embeds: chunk.map((c) => c.embed), allowed_mentions: { parse: [] } }, items: chunk.flatMap((c) => c.items) }));
}

/** The webhook messages for `items`; see {@link buildDiscordBatches}. */
export function buildDiscordMessages(items: DiscordItem[]): DiscordMessage[] {
  return buildDiscordBatches(items).map((b) => b.message);
}

/** A message with one embed of default colour, such as the webhook test message. */
export function plainMessage(text: string, href: string, projectName: string): DiscordMessage {
  return {
    embeds: [{ description: clip(text, TEXT_LENGTH), url: href, color: COLOR.default, footer: footer(projectName, null) }],
    allowed_mentions: { parse: [] },
  };
}

/** The weekly digest as one message of at most 6000 characters with a field per non-empty section, or `null` when every section is empty. */
export function buildDigest(data: DigestData): DiscordMessage | null {
  const questions = [...data.questions.filter((q) => q.blocking).map((q) => `Blocking: ${q.title}`), ...data.questions.filter((q) => !q.blocking).map((q) => q.title)];
  const sections: [string, string[]][] = [
    ["Shipped", data.shipped],
    ["Started", data.started],
    ["Blocked now", data.blocked],
    ["Open questions", questions],
    ["Decisions accepted", data.accepted],
  ];
  const filled = sections.filter(([, lines]) => lines.length > 0).map(([name, lines]) => ({ name: `${name} (${lines.length})`, lines }));
  if (filled.length === 0) return null;
  const title = clip(`Weekly digest for ${data.projectName}`, TITLE_LENGTH);
  const foot = footer(data.projectName, null);
  // The values share what the title, footer and field names leave of the message limit.
  const room = MESSAGE_LENGTH - title.length - foot.text.length - filled.reduce((sum, f) => sum + f.name.length, 0);
  const valueLength = Math.min(TEXT_LENGTH, Math.floor(room / filled.length));
  const fields = filled.map((f) => ({ name: f.name, value: clip(bullets(f.lines.map(mentionsToPlain), DIGEST_LINES), valueLength) }));
  return { embeds: [{ title, url: data.href, color: COLOR.default, fields, footer: foot }], allowed_mentions: { parse: [] } };
}
