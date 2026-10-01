import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSubscription } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { subscribePush } from "@/lib/ops/push";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { POST } from "./route";

/** Stand-ins for the session and the database, so tests choose the signed-in actor. */
const { session, testDb } = vi.hoisted(() => ({ session: { actor: null as unknown }, testDb: { current: null as unknown } }));
vi.mock("@/lib/auth/actor", () => ({ sessionActor: async () => session.actor }));
vi.mock("@/db/client", () => ({ getDb: () => testDb.current }));

let db: Db;
let owner: Actor;
let other: Actor;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  db = await createTestDb();
  testDb.current = db;
  ({ owner } = await createProjectFixture(db));
  other = await insertUser(db, { name: "Other" });
  session.actor = owner;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const keys = { p256dh: "p256dh-key", auth: "auth-key" };

/** Posts `body`; a header set to null is left out. */
function post(body: unknown, headers: Record<string, string | null> = {}): Promise<Response> {
  const all = {
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36",
    "sec-fetch-site": "same-origin",
    origin: "http://localhost:3000",
    ...headers,
  };
  return POST(
    new Request("http://test/api/push/resubscribe", {
      method: "POST",
      headers: Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => e[1] !== null)),
      body: JSON.stringify(body),
    }),
  );
}

async function endpoints(): Promise<{ endpoint: string; userId: string; label: string }[]> {
  return db
    .select({ endpoint: pushSubscription.endpoint, userId: pushSubscription.userId, label: pushSubscription.label })
    .from(pushSubscription)
    .orderBy(pushSubscription.endpoint);
}

describe("POST /api/push/resubscribe", () => {
  it("answers 401 without a session", async () => {
    session.actor = null;
    const response = await post({ oldEndpoint: null, subscription: { endpoint: "https://push.example.com/new", keys }, label: null });
    expect(response.status).toBe(401);
    expect(await endpoints()).toEqual([]);
  });

  it("saves the new subscription and deletes the actor's old one, keeping its label", async () => {
    await subscribePush(db, owner, { endpoint: "https://push.example.com/old", keys, label: "Firefox on Android" });

    const response = await post({ oldEndpoint: "https://push.example.com/old", subscription: { endpoint: "https://push.example.com/new", keys }, label: null });

    expect(response.status).toBe(200);
    expect(await endpoints()).toEqual([{ endpoint: "https://push.example.com/new", userId: owner.userId, label: "Firefox on Android" }]);
  });

  it("leaves an old endpoint owned by someone else", async () => {
    await subscribePush(db, other, { endpoint: "https://push.example.com/old", keys, label: "Safari on iPhone" });

    const response = await post({ oldEndpoint: "https://push.example.com/old", subscription: { endpoint: "https://push.example.com/new", keys }, label: null });

    expect(response.status).toBe(200);
    expect(await endpoints()).toEqual([
      { endpoint: "https://push.example.com/new", userId: owner.userId, label: "Chrome on Windows" },
      { endpoint: "https://push.example.com/old", userId: other.userId, label: "Safari on iPhone" },
    ]);
  });

  it("answers 403 to a cross-site or non-JSON request", async () => {
    const body = { oldEndpoint: null, subscription: { endpoint: "https://push.example.com/new", keys }, label: null };
    expect((await post(body, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    expect((await post(body, { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await post(body, { "sec-fetch-site": null, origin: "https://evil.example" })).status).toBe(403);
    expect((await post(body, { "content-type": "text/plain" })).status).toBe(403);
    expect(await endpoints()).toEqual([]);
  });

  it("trusts Sec-Fetch-Site: same-origin over an Origin that differs from the configured site URL", async () => {
    const body = { oldEndpoint: null, subscription: { endpoint: "https://push.example.com/new", keys }, label: null };
    expect((await post(body, { origin: "https://www.roadmap.example" })).status).toBe(200);
    expect((await post(body, { "sec-fetch-site": null })).status).toBe(200);
  });

  it("answers 400 for a malformed body", async () => {
    const response = await post({ subscription: { endpoint: "http://push.example.com/new", keys } });
    expect(response.status).toBe(400);
    expect(await endpoints()).toEqual([]);
  });
});
