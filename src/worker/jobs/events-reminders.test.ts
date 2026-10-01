import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, eventUpload, notification } from "@/db/schema";
import { newId } from "@/lib/id";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { ensurePrepTodos } from "@/lib/ops/request-setup";
import { testDeps } from "../deps";
import { registeredRepeatables, runJob } from "../jobs";
import "./events-reminders";

const DAY = 86_400_000;
const NOW = new Date("2026-01-14T12:00:00Z");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reminders-"));
  vi.stubEnv("EVENT_UPLOADS_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** A world with an accepted request whose announcement is overdue, an unposted post row and a requester. */
async function world() {
  const db = await createTestDb();
  await insertUser(db, { name: "Admin", isAdmin: true });
  const developer = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const requester = await insertUser(db, { name: "Requester" });
  const request = await requestFixture(db, requester, { status: "accepted", startsAt: new Date(NOW.getTime() + 6 * DAY) });
  await ensurePrepTodos(db, request, developer.userId);
  const [post] = await db.insert(eventPost).values({ id: newId(), requestId: request.id, kind: "announcement", status: "draft", text: "Hallo" }).returning();
  return { db, request, requester, post };
}

describe("events.reminders registration", () => {
  it("is repeatable hourly at minute 10 UTC on the maintenance queue", () => {
    expect(registeredRepeatables().find((r) => r.jobName === "events.reminders")).toMatchObject({ queue: "maintenance", schedule: { cron: "10 * * * *" } });
  });
});

describe("events.reminders", () => {
  it("only creates notifications: no fetch, nothing on the deliver queue, no post or status change", async () => {
    const w = await world();
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    const deps = testDeps(w.db, { now: () => NOW });
    const postsBefore = await w.db.select().from(eventPost);
    const requestBefore = (await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id)))[0];

    await runJob("maintenance", "events.reminders", {}, deps);

    const created = await w.db.select().from(notification);
    expect(created.some((n) => n.sourceKey.startsWith(`req:${w.request.id}:post:announcement:`) && n.sourceKey.endsWith(":late"))).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
    for (const queue of Object.values(deps.queues)) expect(queue.jobs).toHaveLength(0);
    expect(await w.db.select().from(eventPost)).toEqual(postsBefore);
    expect((await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id)))[0]).toEqual(requestBefore);
  });

  it("creates nothing new when it runs twice in a row", async () => {
    const w = await world();
    const deps = testDeps(w.db, { now: () => NOW });
    await runJob("maintenance", "events.reminders", {}, deps);
    const first = (await w.db.select().from(notification)).length;
    expect(first).toBeGreaterThan(0);
    await runJob("maintenance", "events.reminders", {}, deps);
    expect(await w.db.select().from(notification)).toHaveLength(first);
  });

  it("deletes an old unreferenced upload file and keeps a referenced one and a fresh one", async () => {
    const w = await world();
    const old = new Date(NOW.getTime() - 3 * DAY);
    await mkdir(dir, { recursive: true });
    const orphan = `${newId()}.png`;
    const referenced = `${newId()}.png`;
    const fresh = `${newId()}.png`;
    for (const name of [orphan, referenced, fresh]) await writeFile(path.join(dir, name), "x");
    for (const name of [orphan, referenced]) await utimes(path.join(dir, name), old, old);
    await w.db.insert(eventUpload).values({ id: newId(), requestId: w.request.id, uploaderId: w.requester.userId, purpose: "banner", originalName: "a.png", mime: "image/png", bytes: 1, storageKey: referenced });
    // The job's clock is fixed in January 2026; the fresh file is "new" relative to it.
    await utimes(path.join(dir, fresh), NOW, NOW);
    await runJob("maintenance", "events.reminders", {}, testDeps(w.db, { now: () => NOW }));
    expect((await readdir(dir)).sort()).toEqual([fresh, referenced].sort());
  });
});
