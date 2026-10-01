import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { memoryKv } from "@/lib/kv";
import { getPref } from "@/lib/ops/prefs";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { createCallerFactory } from "../init";
import { appRouter } from "../router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor`. */
function caller(db: Db, actor: Actor) {
  return createCallerFactory(appRouter)({ db, actor, sessionId: null, kv: memoryKv() });
}

describe("account language and time zone", () => {
  it("stores a supported locale", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await caller(db, user).account.setLocale({ locale: "de" });
    expect(await getPref(db, user.userId, "locale")).toBe("de");
  });

  it("rejects an unsupported locale as BAD_REQUEST", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    // @ts-expect-error "fr" is not a supported locale
    await expect(caller(db, user).account.setLocale({ locale: "fr" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("stores a known time zone", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await caller(db, user).account.setTimeZone({ timeZone: "Europe/Berlin" });
    expect(await getPref(db, user.userId, "timeZone")).toBe("Europe/Berlin");
  });

  it("rejects an unknown time zone as BAD_REQUEST", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await expect(caller(db, user).account.setTimeZone({ timeZone: "Mars/Base" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unknown time zone.",
    });
    expect(await getPref(db, user.userId, "timeZone")).toBeNull();
  });
});
