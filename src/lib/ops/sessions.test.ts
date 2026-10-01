import { describe, expect, it } from "vitest";
import { session } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { NotFoundError } from "./errors";
import { endOtherSessions, endSession, listSessions } from "./sessions";

const DAY = 86_400_000;

async function addSession(db: Db, userId: string, id: string, over: Partial<typeof session.$inferInsert> = {}) {
  await db.insert(session).values({ id, token: `t-${id}`, userId, expiresAt: new Date(Date.now() + DAY), ...over });
}

describe("sessions", () => {
  it("lists unexpired sessions, the current one first, with a device description", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await addSession(db, alex.userId, "old", { updatedAt: new Date(1000), userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", ipAddress: "10.0.0.1" });
    await addSession(db, alex.userId, "recent", { updatedAt: new Date(3000) });
    await addSession(db, alex.userId, "current", { updatedAt: new Date(2000) });
    await addSession(db, alex.userId, "expired", { expiresAt: new Date(Date.now() - DAY) });
    await addSession(db, sam.userId, "foreign");
    const rows = await listSessions(db, alex, "current");
    expect(rows.map((r) => [r.id, r.current])).toEqual([
      ["current", true],
      ["recent", false],
      ["old", false],
    ]);
    expect(rows[2]).toMatchObject({ browser: "Firefox", system: "Linux", ip: "10.0.0.1", lastActiveAt: new Date(1000) });
    expect(rows[1]).toMatchObject({ browser: null, system: null, ip: null });
  });

  it("ends all but the current session", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    for (const id of ["a", "b", "c"]) await addSession(db, alex.userId, id);
    await addSession(db, sam.userId, "s");
    expect(await endOtherSessions(db, alex, "b")).toEqual({ ended: 2 });
    expect((await db.select().from(session)).map((s) => s.id).sort()).toEqual(["b", "s"]);
  });

  it("ends one own session and hides other users' sessions", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await addSession(db, sam.userId, "s");
    await addSession(db, alex.userId, "a");
    await expect(endSession(db, alex, "s")).rejects.toThrow(NotFoundError);
    await expect(endSession(db, alex, "nope")).rejects.toThrow(NotFoundError);
    await endSession(db, alex, "a");
    expect((await db.select().from(session)).map((s) => s.id)).toEqual(["s"]);
  });
});
