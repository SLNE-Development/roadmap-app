import { beforeAll, describe, expect, it, vi } from "vitest";
import { oauthClient } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { consentRequest } from "./consent";

/** The database Better Auth runs on. */
const { testDb } = vi.hoisted(() => ({ testDb: { current: null as unknown } }));
vi.mock("@/db/client", () => ({ getDb: () => testDb.current }));

describe("consentRequest", () => {
  let db: Db;

  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://roadmap.test");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("DISCORD_CLIENT_ID", "id");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    db = await createTestDb();
    testDb.current = db;
    await db.insert(oauthClient).values({
      id: "c1",
      clientId: "cli-1",
      name: "Claude Code",
      redirectUris: ["http://127.0.0.1:5555/callback"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("refuses a query without a signature", async () => {
    expect(await consentRequest("client_id=cli-1&scope=openid")).toBeNull();
  });

  it("refuses a query whose signature does not match", async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(await consentRequest(`client_id=cli-1&scope=openid&exp=${exp}&sig=forged`)).toBeNull();
  });
});
