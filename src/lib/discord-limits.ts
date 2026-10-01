/** Discord's message limits; lengths are Unicode code points. */
export const LIMITS = {
  content: 2000,
  embedTotal: 6000,
  embeds: 10,
  fields: 25,
  embedTitle: 256,
  embedDescription: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
} as const;

/** An embed as the app stores it; `color` is `#rrggbb`, the image an upload (sent as an attachment). */
export interface Embed {
  title: string;
  description: string;
  color: string;
  imageUploadId: string | null;
  fields: { name: string; value: string }[];
  footer: string;
  /** The title's link. */
  url?: string | null;
  author?: string;
}

/** The length of `text` in code points; never splits or double-counts an emoji. */
export function textLength(text: string): number {
  return Array.from(text).length;
}

/** The characters Discord counts against the 6,000 limit: title, description, field names and values, footer and author name. */
export function countEmbedChars(embed: Embed): number {
  const fields = embed.fields.reduce((sum, f) => sum + textLength(f.name) + textLength(f.value), 0);
  return textLength(embed.title) + textLength(embed.description) + fields + textLength(embed.footer) + textLength(embed.author ?? "");
}

/** Lists everything in `message` that Discord would refuse; empty when it fits. */
export function messageProblems(message: { content?: string; embeds?: Embed[] }): string[] {
  const problems: string[] = [];
  const embeds = message.embeds ?? [];
  const content = textLength(message.content ?? "");
  if (content > LIMITS.content) problems.push(`content has ${content} characters, the limit is ${LIMITS.content}`);
  if (embeds.length > LIMITS.embeds) problems.push(`${embeds.length} embeds, the limit is ${LIMITS.embeds}`);
  const total = embeds.reduce((sum, e) => sum + countEmbedChars(e), 0);
  if (total > LIMITS.embedTotal) problems.push(`embeds have ${total} characters, the limit is ${LIMITS.embedTotal}`);
  for (const e of embeds) {
    if (e.fields.length > LIMITS.fields) problems.push(`${e.fields.length} fields, the limit is ${LIMITS.fields}`);
    if (textLength(e.title) > LIMITS.embedTitle) problems.push(`the embed title is longer than ${LIMITS.embedTitle}`);
    if (textLength(e.description) > LIMITS.embedDescription) problems.push(`the embed description is longer than ${LIMITS.embedDescription}`);
    if (textLength(e.footer) > LIMITS.footer) problems.push(`the embed footer is longer than ${LIMITS.footer}`);
    for (const f of e.fields) {
      if (textLength(f.name) > LIMITS.fieldName) problems.push(`a field name is longer than ${LIMITS.fieldName}`);
      if (textLength(f.value) > LIMITS.fieldValue) problems.push(`a field value is longer than ${LIMITS.fieldValue}`);
    }
  }
  return problems;
}

/** Whether Discord accepts the message: content, embed totals, embed and field counts and every per-field limit. */
export function fitsMessage(message: { content?: string; embeds?: Embed[] }): boolean {
  return messageProblems(message).length === 0;
}

/** Spans a cut must not fall into: a markdown link and a custom emoji. */
const PROTECTED = /\[[^\]\n]*\]\([^)\s]*\)|<a?:\w+:\d+>/g;

/** A heading line on its own, such as `# Titel`. */
const isHeadingOnly = (paragraph: string): boolean => /^#{1,6}\s+\S/.test(paragraph) && !paragraph.includes("\n");

/** Moves `cut` (a code point index) before the protected span it falls into, when that leaves something to cut. */
function avoidSpans(text: string, cps: string[], cut: number): number {
  for (const m of text.matchAll(PROTECTED)) {
    const start = Array.from(text.slice(0, m.index)).length;
    const end = start + Array.from(m[0]).length;
    if (cut > start && cut < end) return start > 0 ? start : cut;
  }
  return cut;
}

/**
 * Splits one paragraph that is longer than `first` into pieces of at most `first` (the first piece) and `max` (the others)
 * code points: at the last sentence end before the limit, then at the last space, then hard. A cut avoids markdown links and
 * custom emoji when it can. Pieces are trimmed; nothing but whitespace is lost.
 */
function splitLong(text: string, first: number, max: number): string[] {
  const pieces: string[] = [];
  let rest = Array.from(text.trim());
  let limit = first;
  while (rest.length > limit) {
    const joined = rest.join("");
    let cut = -1;
    for (let i = Math.min(limit, rest.length - 1); i >= 1 && cut < 0; i--) {
      if (rest[i] === "\n" && i <= limit) cut = i;
      else if (/[.!?]/.test(rest[i - 1]) && /\s/.test(rest[i]) && i <= limit) cut = i;
    }
    if (cut < 1) {
      for (let i = limit; i >= 1 && cut < 1; i--) if (/\s/.test(rest[i])) cut = i;
    }
    if (cut < 1) cut = limit;
    cut = avoidSpans(joined, rest, cut);
    pieces.push(rest.slice(0, cut).join("").trim());
    rest = Array.from(rest.slice(cut).join("").trimStart());
    limit = max;
  }
  if (rest.length > 0) pieces.push(rest.join("").trim());
  return pieces.filter((p) => p !== "");
}

/**
 * Splits `text` into messages of at most `max` code points (the first at most `firstMax`). Paragraphs (blank-line
 * separated) are packed greedily and joined by a blank line; a heading line stays with the paragraph after it; a paragraph
 * that is too long is split by {@link splitLong}. Chunks are trimmed and empty ones dropped, so joining them loses no
 * non-whitespace character.
 */
export function splitText(text: string, max: number = LIMITS.content, firstMax: number = max): string[] {
  const paragraphs = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter((p) => p !== "");
  const units: { head: string | null; body: string }[] = [];
  let heads: string[] = [];
  for (const p of paragraphs) {
    if (isHeadingOnly(p)) heads.push(p);
    else {
      units.push({ head: heads.length > 0 ? heads.join("\n\n") : null, body: p });
      heads = [];
    }
  }
  if (heads.length > 0) units.push({ head: null, body: heads.join("\n\n") });

  const chunks: string[] = [];
  let cur = "";
  const limit = () => (chunks.length === 0 ? firstMax : max);
  for (const unit of units) {
    const whole = unit.head ? `${unit.head}\n\n${unit.body}` : unit.body;
    if (cur !== "" && textLength(cur) + 2 + textLength(whole) <= limit()) {
      cur += `\n\n${whole}`;
      continue;
    }
    if (cur !== "") {
      chunks.push(cur);
      cur = "";
    }
    if (textLength(whole) <= limit()) {
      cur = whole;
      continue;
    }
    const headLength = unit.head ? textLength(unit.head) + 2 : 0;
    const room = limit() - headLength;
    const pieces = room >= 1 ? splitLong(unit.body, room, max) : splitLong(unit.body, limit(), max);
    if (unit.head && room >= 1) pieces[0] = `${unit.head}\n\n${pieces[0]}`;
    else if (unit.head) chunks.push(unit.head);
    for (const piece of pieces.slice(0, -1)) chunks.push(piece);
    cur = pieces[pieces.length - 1];
  }
  if (cur !== "") chunks.push(cur);
  return chunks;
}
