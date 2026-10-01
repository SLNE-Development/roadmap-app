import type { Embed } from "./discord-limits";

const TIMEOUT_MS = 10_000;

/** Which webhook a call goes to; errors name this, never the url. */
export type WebhookKind = "team" | "public" | "staff";

/** A webhook to call. The url holds the token, so it never leaves this module in an error or a result. */
export interface Webhook {
  kind: WebhookKind;
  url: string;
}

/** An embed as Discord takes it. */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  author?: { name: string };
  image?: { url: string };
}

/** What a message may mention: nothing parsed, and at most the listed roles. */
export interface AllowedMentions {
  parse: [];
  roles?: string[];
}

/** The JSON body of a webhook call. `allowed_mentions` has no optional form: every call decides who may be pinged. */
export interface DiscordBody {
  content?: string;
  embeds?: DiscordEmbed[];
  username: string;
  allowed_mentions: AllowedMentions;
}

/** A file sent with a message and referenced as `attachment://<name>`. */
export interface WebhookFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/** How Discord answered a call. */
export type WebhookResult =
  | { kind: "ok"; id: string }
  | { kind: "retry"; delayMs: number }
  /** 401 or 404. A 404 with `code` 10008 (Unknown Message) means the message is gone, with 10015 (Unknown Webhook) or a 401 the webhook is. */
  | { kind: "gone"; status: 401 | 404; code?: number }
  /** Any other 4xx: Discord refuses this message, retrying never helps. */
  | { kind: "rejected"; status: number }
  /** 5xx or a network error: worth retrying. */
  | { kind: "failed"; error: Error };

/** Reads `retry_after` in seconds from a 429's JSON body or its `Retry-After` header; 1 when neither has it. */
export async function retryAfterSeconds(res: Response): Promise<number> {
  const body: unknown = await res.json().catch(() => null);
  const fromBody = body && typeof body === "object" && "retry_after" in body ? Number(body.retry_after) : NaN;
  if (Number.isFinite(fromBody) && fromBody >= 0) return fromBody;
  const fromHeader = Number(res.headers.get("retry-after"));
  return Number.isFinite(fromHeader) && fromHeader >= 0 ? fromHeader : 1;
}

/** Turns a stored embed into Discord's shape; the image becomes `attachment://<imageName>` when there is one. */
export function toDiscordEmbed(embed: Embed, imageName: string | null): DiscordEmbed {
  return {
    ...(embed.title ? { title: embed.title } : {}),
    ...(embed.description ? { description: embed.description } : {}),
    ...(embed.url ? { url: embed.url } : {}),
    color: parseInt(embed.color.slice(1), 16),
    ...(embed.fields.length > 0 ? { fields: embed.fields } : {}),
    ...(embed.footer ? { footer: { text: embed.footer } } : {}),
    ...(embed.author ? { author: { name: embed.author } } : {}),
    ...(imageName ? { image: { url: `attachment://${imageName}` } } : {}),
  };
}

/** The request body and content type: JSON, or multipart with `payload_json` and `files[n]` when there are files. */
function encode(body: DiscordBody, files: WebhookFile[] | undefined): { body: string | FormData; headers: Record<string, string> } {
  if (!files || files.length === 0) return { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const form = new FormData();
  form.set("payload_json", JSON.stringify({ ...body, attachments: files.map((f, id) => ({ id, filename: f.name })) }));
  files.forEach((f, n) => form.set(`files[${n}]`, new Blob([new Uint8Array(f.bytes)], { type: f.mime }), f.name));
  return { body: form, headers: {} };
}

/** A network error described without its message, which may hold the url: its name and code only. */
function describeNetworkError(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : "";
  return /^[A-Z_]{2,40}$/.test(code) ? `${name} ${code}` : name;
}

/** Calls Discord and maps the answer; `fallbackId` is the id of an answer without a body (edit, delete). */
async function call(hook: Webhook, url: string, init: RequestInit, fallbackId: string | null): Promise<WebhookResult> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { kind: "failed", error: new Error(`Discord request to the ${hook.kind} webhook failed (${describeNetworkError(error)}).`) };
  }
  if (res.ok) {
    if (fallbackId !== null) return { kind: "ok", id: fallbackId };
    const data: unknown = await res.json().catch(() => null);
    const id = data && typeof data === "object" && "id" in data ? String(data.id) : "";
    return id ? { kind: "ok", id } : { kind: "failed", error: new Error(`Discord answered the ${hook.kind} webhook without a message id.`) };
  }
  if (res.status === 429) return { kind: "retry", delayMs: Math.ceil((await retryAfterSeconds(res)) * 1000) + 250 };
  if (res.status === 401 || res.status === 404) {
    const data: unknown = await res.json().catch(() => null);
    const code = data && typeof data === "object" && "code" in data ? Number(data.code) : NaN;
    return Number.isFinite(code) ? { kind: "gone", status: res.status, code } : { kind: "gone", status: res.status };
  }
  if (res.status >= 500) return { kind: "failed", error: new Error(`Discord answered ${res.status} for the ${hook.kind} webhook.`) };
  return { kind: "rejected", status: res.status };
}

/** Posts a message and waits for Discord to answer with its id (`?wait=true`). */
export function sendMessage(hook: Webhook, body: DiscordBody, files?: WebhookFile[]): Promise<WebhookResult> {
  const { body: payload, headers } = encode(body, files);
  return call(hook, `${hook.url}?wait=true`, { method: "POST", headers, body: payload }, null);
}

/** Edits a stored message; the result carries its id. */
export function editMessage(hook: Webhook, messageId: string, body: DiscordBody, files?: WebhookFile[]): Promise<WebhookResult> {
  const { body: payload, headers } = encode(body, files);
  return call(hook, `${hook.url}/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", headers, body: payload }, messageId);
}

/** Deletes a stored message; the result carries its id. */
export function deleteMessage(hook: Webhook, messageId: string): Promise<WebhookResult> {
  return call(hook, `${hook.url}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" }, messageId);
}
