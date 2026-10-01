import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { vi } from "vitest";
import { eventPost, type EventPostRow, type EventRequestRow } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { setEventSecrets, updateEventSettings } from "@/lib/ops/event-settings";
import { ensurePrepTodos } from "@/lib/ops/request-setup";
import { savePostDraft } from "@/lib/ops/request-posts";
import type { PostKind } from "@/lib/event-messages";
import { createTestDb } from "./db";
import { insertUser, requestFixture } from "./fixtures";

/** Marker tokens inside the fixture webhook urls; tests assert they never appear in an error or a stored value. */
export const TEAM_TOKEN = "TEAMTOKENSECRET9876";
export const PUBLIC_TOKEN = "PUBLICTOKENSECRET1234";
export const TEAM_URL = `https://discord.com/api/webhooks/111111111111111111/${TEAM_TOKEN}`;
export const PUBLIC_URL = `https://discord.com/api/webhooks/222222222222222222/${PUBLIC_TOKEN}`;
export const ROLE_ID = "123456789012345678";

/** Stubs the encryption key; call from `beforeEach` and pair with `vi.unstubAllEnvs()` in `afterEach`. */
export function stubEncryptionKey(): void {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
}

/** A paragraph-structured German text of about `length` characters, starting with the event heading. */
export function longText(length: number, heading = "# Fixture event"): string {
  const paragraphs = [heading];
  let size = heading.length;
  for (let i = 0; size < length; i++) {
    const p = `Absatz ${i} ` + "x".repeat(380);
    paragraphs.push(p);
    size += p.length + 2;
  }
  return paragraphs.join("\n\n");
}

/** An admin, a manager, a requester, a stranger and an accepted request in 30 days with its to-dos; webhooks and the ping role are set. */
export async function postWorld(opts: { webhooks?: boolean; status?: EventRequestRow["status"] } = {}) {
  const db = await createTestDb();
  const admin = await insertUser(db, { name: "Admin", isAdmin: true });
  const manager = await insertUser(db, { name: "Manager", isEventManager: true });
  const requester = await insertUser(db, { name: "Requester" });
  const stranger = await insertUser(db, { name: "Stranger" });
  if (opts.webhooks !== false) await setEventSecrets(db, admin, { teamWebhook: TEAM_URL, publicWebhook: PUBLIC_URL });
  await updateEventSettings(db, manager, { pingRoleId: ROLE_ID });
  const request = await requestFixture(db, requester, { status: opts.status ?? "accepted", startsAt: new Date(Date.now() + 30 * 86_400_000), durationMinutes: 90, where: "Hafenwelt" });
  await ensurePrepTodos(db, request, manager.userId);
  return { db, admin, manager, requester, stranger, request };
}

/** Saves a draft of `kind` for the request and returns the row. */
export async function draftPost(db: Db, actor: Actor, requestId: string, kind: PostKind, input: Parameters<typeof savePostDraft>[4]): Promise<EventPostRow> {
  await savePostDraft(db, actor, requestId, kind, input);
  const [row] = await db.select().from(eventPost).where(and(eq(eventPost.requestId, requestId), eq(eventPost.kind, kind)));
  return row;
}
