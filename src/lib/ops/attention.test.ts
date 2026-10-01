import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, progressUpdate, question } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { projectAttention } from "./attention";
import { setSystemArchived } from "./archive";
import { createAdr } from "./adrs";
import { addQuestion } from "./questions";
import { createSystem, moveSystem } from "./systems";
import { addTask, updateTask } from "./tasks";
import { postUpdate } from "./updates";

const now = new Date("2026-10-10T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

/** Sets every change-log entry and update of a system to `at`, so a test controls its last activity. */
async function setActivity(db: Db, systemId: string, at: Date) {
  await db.update(changeLog).set({ createdAt: at }).where(eq(changeLog.systemId, systemId));
  await db.update(progressUpdate).set({ createdAt: at }).where(eq(progressUpdate.systemId, systemId));
}

/** Creates a system with finished planning, moved to the named default column. */
async function systemIn(db: Db, owner: Awaited<ReturnType<typeof insertUser>>, slug: string, key: string, column: string) {
  const s = await createSystem(db, owner, slug, { slug: key, title: key.toUpperCase() });
  await completePlanningFixture(db, s.id);
  await moveSystem(db, owner, slug, key, { column });
  return s;
}

describe("projectAttention", () => {
  it("flags active and review systems with no activity for more than 7 days, not todo ones", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const old = await systemIn(db, owner, slug, "old", "In progress");
    const fresh = await systemIn(db, owner, slug, "fresh", "In progress");
    const review = await systemIn(db, owner, slug, "review", "Review");
    const todo = await systemIn(db, owner, slug, "todo", "Todo");
    await setActivity(db, old.id, daysAgo(20));
    await postUpdate(db, owner, slug, "old", { summary: "Started" });
    await setActivity(db, old.id, daysAgo(8));
    await setActivity(db, fresh.id, daysAgo(20));
    await db.update(changeLog).set({ createdAt: daysAgo(2) }).where(eq(changeLog.systemId, fresh.id));
    await setActivity(db, review.id, daysAgo(10));
    await setActivity(db, todo.id, daysAgo(30));
    const stale = (await projectAttention(db, owner, slug, now)).filter((i) => i.kind === "stale");
    expect(stale.map((i) => [i.title, i.href, i.systemId])).toEqual([
      ["OLD has had no update for 8 days", `/p/${slug}/systems/old`, old.id],
      ["REVIEW has had no update for 10 days", `/p/${slug}/systems/review`, review.id],
    ]);
    expect(stale[0].at).toEqual(daysAgo(8));
  });

  it("lists blocking questions at any age before stale normal ones", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const normalOld = await addQuestion(db, owner, slug, { title: "Old one" });
    const normalYoung = await addQuestion(db, owner, slug, { title: "Young one" });
    const blocking = await addQuestion(db, owner, slug, { title: "Blocker", priority: "blocking" });
    await db.update(question).set({ createdAt: daysAgo(6) }).where(eq(question.id, normalOld.id));
    await db.update(question).set({ createdAt: daysAgo(4) }).where(eq(question.id, normalYoung.id));
    await db.update(question).set({ createdAt: daysAgo(1) }).where(eq(question.id, blocking.id));
    const items = (await projectAttention(db, owner, slug, now)).filter((i) => i.kind === "question");
    expect(items.map((i) => i.title)).toEqual(["Blocker", "Old one"]);
    expect(items[0].detail.startsWith("Blocking · ")).toBe(true);
    expect(items[1].detail.startsWith("Blocking · ")).toBe(false);
    expect(items[0].href).toBe(`/p/${slug}/questions`);
  });

  it("links a question of a system to the questions page filtered by that system", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await addQuestion(db, owner, slug, { title: "Q", system: "a", priority: "blocking" });
    const [item] = (await projectAttention(db, owner, slug, now)).filter((i) => i.kind === "question");
    expect(item.href).toBe(`/p/${slug}/questions?system=a`);
    expect(item.systemId).toBe(s.id);
  });

  it("shows blocked tasks with their reason", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "a", title: "Alpha" });
    await completePlanningFixture(db, s.id);
    const t = await addTask(db, owner, slug, "a", { title: "Call API" });
    await updateTask(db, owner, t.id, { state: "blocked", blockedReason: "waiting for API key" });
    const [item] = (await projectAttention(db, owner, slug, now)).filter((i) => i.kind === "blocked-task");
    expect(item).toMatchObject({
      title: `Task #${t.id} is blocked`,
      detail: "Alpha · waiting for API key",
      href: `/p/${slug}/systems/a`,
      systemId: s.id,
    });
  });

  it("explains a blocked system by its latest update, or says none does", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const withUpdate = await systemIn(db, owner, slug, "a", "Blocked");
    await systemIn(db, owner, slug, "b", "Blocked");
    await postUpdate(db, owner, slug, "a", { summary: "Waiting on vendor" });
    await db.update(progressUpdate).set({ createdAt: daysAgo(3) }).where(eq(progressUpdate.systemId, withUpdate.id));
    const blocked = (await projectAttention(db, owner, slug, now)).filter((i) => i.kind === "blocked");
    expect(blocked.map((i) => [i.title, i.detail])).toEqual([
      ["A is blocked", "Waiting on vendor"],
      ["B is blocked", "No update explains why yet."],
    ]);
  });

  it("lists planning systems and proposed decisions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "Alpha" });
    await createAdr(db, owner, slug, { title: "Use X", context: "c", decision: "d", alternatives: "a", consequences: "q" });
    const items = await projectAttention(db, owner, slug, now);
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ["planning", "Alpha is still in planning"],
      ["decision", "ADR-0001 is waiting for acceptance"],
    ]);
    expect(items[0].href).toBe(`/p/${slug}/systems/a?tab=planning`);
  });

  it("carries the facts of each item as params", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "Alpha" });
    await createAdr(db, owner, slug, { title: "Use X", context: "c", decision: "d", alternatives: "a", consequences: "q" });
    const items = await projectAttention(db, owner, slug, now);
    expect(items[0].params).toMatchObject({ kind: "planning", system: "Alpha", noSpec: true });
    expect(items[1].params).toEqual({ kind: "decision", number: "0001", title: "Use X" });
  });

  it("leaves out everything of an archived system", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await systemIn(db, owner, slug, "a", "Blocked");
    const t = await addTask(db, owner, slug, "a", { title: "T" });
    await updateTask(db, owner, t.id, { state: "blocked", blockedReason: "why" });
    await addQuestion(db, owner, slug, { title: "Q", system: "a", priority: "blocking" });
    await setActivity(db, s.id, daysAgo(30));
    await setSystemArchived(db, owner, slug, "a", true);
    expect(await projectAttention(db, owner, slug, now)).toEqual([]);
  });

  it("hides the project from non-members", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = await insertUser(db);
    await expect(projectAttention(db, stranger, slug, now)).rejects.toMatchObject({ status: 404 });
  });
});
