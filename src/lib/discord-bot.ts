import { retryAfterSeconds } from "./discord-webhook";

const BASE = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

/** How Discord answered a bot call. Nothing in it, an error included, holds the token. */
export type BotResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "retry"; delayMs: number }
  /** 404: the event, or the guild, does not exist (any more). */
  | { kind: "gone" }
  /** 401 (bad token) or 403 (no permission); `code` is Discord's error code, 50013 meaning missing permissions. */
  | { kind: "denied"; status: 401 | 403; code?: number }
  /** Any other 4xx: Discord refuses this request, retrying never helps. */
  | { kind: "rejected"; status: number; message: string }
  /** 5xx or a network error: worth retrying. */
  | { kind: "failed"; error: Error };

/** The fields of a scheduled event as the app sends them. */
export interface ScheduledEventBody {
  name: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  location: string;
  /** The banner as a `data:` URI. */
  imageDataUri?: string;
}

/** The link of a scheduled event; the link in the post's last message. */
export const scheduledEventUrl = (guildId: string, eventId: string): string => `https://discord.com/events/${guildId}/${eventId}`;

/** Discord's field names for the changed fields only. */
function toDiscord(body: Partial<ScheduledEventBody>): Record<string, unknown> {
  return {
    ...(body.name !== undefined ? { name: body.name.slice(0, 100) } : {}),
    ...(body.description !== undefined ? { description: body.description.slice(0, 1000) } : {}),
    ...(body.startsAt ? { scheduled_start_time: body.startsAt.toISOString() } : {}),
    ...(body.endsAt ? { scheduled_end_time: body.endsAt.toISOString() } : {}),
    ...(body.location !== undefined ? { entity_metadata: { location: body.location } } : {}),
    ...(body.imageDataUri ? { image: body.imageDataUri } : {}),
  };
}

/** A network error described by name and code only. */
function describeNetworkError(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : "";
  return /^[A-Z_]{2,40}$/.test(code) ? `${name} ${code}` : name;
}

/** Calls the REST API and maps the answer; `read` turns a 2xx body into the value. */
async function call<T>(token: string, path: string, init: { method: string; body?: unknown }, read: (data: unknown) => T | null): Promise<BotResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers: { Authorization: `Bot ${token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "failed", error: new Error(`Discord request failed (${describeNetworkError(error)}).`) };
  }
  if (res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const value = read(data);
    return value === null ? { kind: "failed", error: new Error("Discord answered without the expected data.") } : { kind: "ok", value };
  }
  if (res.status === 429) return { kind: "retry", delayMs: Math.ceil((await retryAfterSeconds(res)) * 1000) + 250 };
  if (res.status === 404) return { kind: "gone" };
  const data: unknown = await res.json().catch(() => null);
  const code = data && typeof data === "object" && "code" in data ? Number(data.code) : NaN;
  if (res.status === 401 || res.status === 403) return Number.isFinite(code) ? { kind: "denied", status: res.status, code } : { kind: "denied", status: res.status };
  if (res.status >= 500) return { kind: "failed", error: new Error(`Discord answered ${res.status}.`) };
  const message = data && typeof data === "object" && "message" in data ? String(data.message).split(token).join("") : "";
  return { kind: "rejected", status: res.status, message: message.slice(0, 200) };
}

const readId = (data: unknown): { id: string } | null => (data && typeof data === "object" && "id" in data ? { id: String(data.id) } : null);

/** Creates an external, guild-only scheduled event. */
export function createScheduledEvent(token: string, guildId: string, body: ScheduledEventBody): Promise<BotResult<{ id: string }>> {
  return call(token, `/guilds/${encodeURIComponent(guildId)}/scheduled-events`, { method: "POST", body: { ...toDiscord(body), entity_type: 3, privacy_level: 2 } }, readId);
}

/** Changes the given fields of a scheduled event. */
export function updateScheduledEvent(token: string, guildId: string, eventId: string, body: Partial<ScheduledEventBody>): Promise<BotResult<{ id: string }>> {
  return call(token, `/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: { ...toDiscord(body), ...(body.location !== undefined ? { entity_type: 3 } : {}) } }, readId);
}

/** Deletes a scheduled event. */
export function deleteScheduledEvent(token: string, guildId: string, eventId: string): Promise<BotResult<true>> {
  return call(token, `/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}`, { method: "DELETE" }, () => true as const);
}
