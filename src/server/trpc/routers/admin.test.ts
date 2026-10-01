import { describe, expect, it, vi } from "vitest";
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

describe("admin.setEventRole", () => {
  it("lets an admin set a role and shows it in the accounts list", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const sam = await insertUser(db, { name: "Sam" });
    const api = caller(db, admin);
    await api.admin.setEventRole({ userId: sam.userId, role: "developer", value: true });
    const rows = await api.account.accounts();
    expect(rows.find((r) => r.userId === sam.userId)).toMatchObject({ isEventDeveloper: true, isEventManager: false });
  });

  it("is forbidden for a non-admin", async () => {
    const db = await createTestDb();
    const sam = await insertUser(db, { name: "Sam" });
    await expect(caller(db, sam).admin.setEventRole({ userId: sam.userId, role: "manager", value: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
