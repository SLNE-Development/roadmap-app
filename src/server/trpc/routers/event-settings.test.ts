import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import { memoryKv } from "@/lib/kv";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { createCallerFactory } from "../init";
import { appRouter } from "../router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor`. */
const caller = (db: Db, actor: Actor) => createCallerFactory(appRouter)({ db, actor, sessionId: null, kv: memoryKv() });

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

describe("requests.settings router", () => {
  it("answers FORBIDDEN before it validates the input", async () => {
    const db = await createTestDb();
    const developer = await insertUser(db, { isEventDeveloper: true });
    const stranger = await insertUser(db, {});
    const manager = await insertUser(db, { isEventManager: true });
    await expect(caller(db, developer).requests.settings.update({ timeZone: "Mars/Base" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(db, stranger).requests.settings.update({ nonsense: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(db, manager).requests.settings.setSecrets({ botToken: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(db, stranger).requests.settings.preview({ kind: "bogus" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("still validates for those who may", async () => {
    const db = await createTestDb();
    const manager = await insertUser(db, { isEventManager: true });
    await expect(caller(db, manager).requests.settings.update({ publicWebhook: "https://discord.com/api/webhooks/1/x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller(db, manager).requests.settings.update({ postAs: "Crew" });
    expect((await caller(db, manager).requests.settings.get()).postAs).toBe("Crew");
  });
});
