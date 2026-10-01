import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { boardColumn, changeLog, githubAccount, githubDelivery, githubRepo, notification, projectMember, system, task } from "@/db/schema";
import type { Db } from "@/db/types";
import type { NotificationKind } from "@/lib/notification-kinds";
import { fakeGitHubApi } from "@/lib/github/fake";
import { createSystem } from "@/lib/ops/systems";
import { addTask, updateTask } from "@/lib/ops/tasks";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { handleGitHubEvent } from "./events";
import "./pulls";

const api = fakeGitHubApi();
const getApi = async () => api;
const repository = { id: 42, full_name: "Org/App" };

let seq = 0;

/** Runs one App delivery and returns its stored status and detail. */
async function deliver(db: Db, payload: unknown): Promise<{ status: string; detail: string | null }> {
  seq += 1;
  const deliveryId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await db.insert(githubDelivery).values({ deliveryId, source: "app", event: "pull_request" });
  await handleGitHubEvent({ deliveryId, event: "pull_request", source: "app", repoId: null, payload }, testDeps(db), getApi);
  const [row] = await db.select().from(githubDelivery).where(eq(githubDelivery.deliveryId, deliveryId));
  return { status: row.status, detail: row.detail };
}

function pullRequest(action: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    action,
    repository,
    pull_request: {
      number: 419,
      title,
      body: "",
      html_url: "https://github.com/Org/App/pull/419",
      state: "open",
      merged: false,
      draft: false,
      head: { sha: "abc" },
      user: { login: "octo", id: 500 },
      ...extra,
    },
  };
}

const merged = (title: string, extra: Record<string, unknown> = {}, authorId = 500) =>
  pullRequest("closed", title, { state: "closed", merged: true, user: { login: "octo", id: authorId }, ...extra });

/**
 * Project P (owner O, editor E with GitHub id 500, viewer V with 600), repo R created by O with `rules`, and system
 * `search-index` (planning complete, owned by O) with task t1 owned by O.
 */
async function setup(rules: Partial<{ closeOnMerge: boolean; reviewOnOpen: boolean; checksWarning: boolean }> = { closeOnMerge: true }) {
  const db = await createTestDb();
  const p = await createProjectFixture(db, "p");
  const editor = await addMemberFixture(db, p.owner, "p", "editor", "Edith");
  const viewer = await addMemberFixture(db, p.owner, "p", "viewer", "Vic");
  await db.insert(githubAccount).values([
    { userId: editor.userId, githubId: 500, login: "edith" },
    { userId: viewer.userId, githubId: 600, login: "vic" },
  ]);
  const sys = await createSystem(db, p.owner, "p", { slug: "search-index", title: "Search index" });
  await db.update(system).set({ ownerUserId: p.owner.userId }).where(eq(system.id, sys.id));
  await completePlanningFixture(db, sys.id);
  const { id: t1 } = await addTask(db, p.owner, "p", "search-index", { title: "Results" });
  await updateTask(db, p.owner, t1, { ownerUserId: p.owner.userId });
  await db.insert(githubRepo).values({
    id: "r1",
    projectId: p.projectId,
    fullName: "Org/App",
    fullNameKey: "org/app",
    mode: "app",
    githubRepoId: 42,
    createdBy: p.owner.userId,
    rules: { closeOnMerge: false, reviewOnOpen: false, checksWarning: false, ...rules },
  });
  return { db, p, editor, viewer, systemId: sys.id, boardId: sys.boardId, t1 };
}

const stateOf = async (db: Db, id: number) => (await db.select().from(task).where(eq(task.id, id)))[0].state;
const notices = (db: Db, kind: NotificationKind) => db.select().from(notification).where(eq(notification.kind, kind));
const taskStateLog = (db: Db) => db.select().from(changeLog).where(and(eq(changeLog.entity, "task"), eq(changeLog.field, "state")));

/** Puts the system into the board's first column of `category`. */
async function moveTo(db: Db, systemId: string, boardId: string, category: "active" | "review") {
  const [column] = await db
    .select()
    .from(boardColumn)
    .where(and(eq(boardColumn.boardId, boardId), eq(boardColumn.category, category)))
    .orderBy(boardColumn.sortOrder);
  await db.update(system).set({ columnId: column.id }).where(eq(system.id, systemId));
  return column;
}

const columnOf = async (db: Db, systemId: string) => (await db.select().from(system).where(eq(system.id, systemId)))[0].columnId;

describe("close on merge", () => {
  it("closes the task as the linked editor, through the GitHub agent", async () => {
    const { db, editor, t1 } = await setup();
    const outcome = await deliver(db, merged(`feat: results [roadmap#${t1}]`));
    expect(outcome.status).toBe("done");
    expect(outcome.detail).toContain(`closed task ${t1}`);
    expect(await stateOf(db, t1)).toBe("done");
    expect(await taskStateLog(db)).toMatchObject([{ authorUserId: editor.userId, agent: "GitHub", newValue: "done" }]);
  });

  it("falls back to the repository creator when the author is not linked", async () => {
    const { db, p, t1 } = await setup();
    await deliver(db, merged(`feat [roadmap#${t1}]`, {}, 999));
    expect(await stateOf(db, t1)).toBe("done");
    expect(await taskStateLog(db)).toMatchObject([{ authorUserId: p.owner.userId, agent: "GitHub" }]);
  });

  it("skips when neither the author nor the creator may edit", async () => {
    const { db, p, t1 } = await setup();
    await db.update(projectMember).set({ role: "viewer" }).where(eq(projectMember.userId, p.owner.userId));
    const outcome = await deliver(db, merged(`feat [roadmap#${t1}]`, {}, 600));
    expect(outcome.status).toBe("skipped");
    expect(outcome.detail).toContain("no one to act as");
    expect(await stateOf(db, t1)).toBe("todo");
  });

  it("leaves a task alone that was only mentioned in the body", async () => {
    const { db, t1 } = await setup();
    await deliver(db, merged("feat: results", { body: `roadmap#${t1}` }));
    expect(await stateOf(db, t1)).toBe("todo");
  });

  it("only notifies the owner when the rule is off, and only once", async () => {
    const { db, p, t1 } = await setup({ closeOnMerge: false });
    const payload = merged(`feat [roadmap#${t1}]`);
    await deliver(db, payload);
    await deliver(db, payload);
    expect(await stateOf(db, t1)).toBe("todo");
    const rows = await notices(db, "pr.merged");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: p.owner.userId, title: `PR #419 merged: feat [roadmap#${t1}]`, sourceKey: "pr-merged:r1:419" });
    expect(rows[0].href).toBe("/p/p/systems/search-index");
  });
});

describe("close on merge failures and merge notices", () => {
  it("tells the task owner when the task cannot be closed", async () => {
    const { db, p, systemId, t1 } = await setup();
    await db.update(system).set({ planningCompletedAt: null, planningConfirmation: null }).where(eq(system.id, systemId));
    const outcome = await deliver(db, merged(`feat [roadmap#${t1}]`));
    expect(outcome.detail).toContain(`task ${t1} not closed`);
    const rows = await notices(db, "automation.blocked");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: p.owner.userId, sourceKey: `automation-blocked:r1:419:task-${t1}` });
    await deliver(db, merged(`feat [roadmap#${t1}]`));
    expect(await notices(db, "automation.blocked")).toHaveLength(1);
  });

  it("falls back to the system owner when the task has no owner", async () => {
    const { db, p, systemId, t1 } = await setup();
    await db.update(task).set({ ownerUserId: null }).where(eq(task.id, t1));
    await db.update(system).set({ planningCompletedAt: null, planningConfirmation: null }).where(eq(system.id, systemId));
    await deliver(db, merged(`feat [roadmap#${t1}]`));
    expect(await notices(db, "automation.blocked")).toMatchObject([{ userId: p.owner.userId }]);
  });

  it("names the author in the merge notice and never notifies the author", async () => {
    const { db, p, editor, t1 } = await setup({ closeOnMerge: false });
    await deliver(db, merged(`feat [roadmap#${t1}]`));
    expect(await notices(db, "pr.merged")).toMatchObject([{ userId: p.owner.userId, actorName: "GitHub for Edith" }]);

    await db.update(task).set({ ownerUserId: editor.userId }).where(eq(task.id, t1));
    await db.delete(notification);
    await deliver(db, merged(`feat [roadmap#${t1}]`));
    expect(await notices(db, "pr.merged")).toEqual([]);
  });
});

describe("review on open", () => {
  const openPr = (extra: Record<string, unknown> = {}) => pullRequest("opened", "feat roadmap:search-index", extra);

  it("moves an active system to the first review column", async () => {
    const { db, systemId, boardId } = await setup({ reviewOnOpen: true });
    await moveTo(db, systemId, boardId, "active");
    const outcome = await deliver(db, openPr());
    expect(outcome.status).toBe("done");
    const [review] = await db
      .select()
      .from(boardColumn)
      .where(and(eq(boardColumn.boardId, boardId), eq(boardColumn.category, "review")))
      .orderBy(boardColumn.sortOrder);
    expect(await columnOf(db, systemId)).toBe(review.id);
  });

  it("does not move a system whose planning is incomplete and notifies the owner", async () => {
    const { db, p, systemId, boardId } = await setup({ reviewOnOpen: true });
    const active = await moveTo(db, systemId, boardId, "active");
    await db.update(system).set({ planningCompletedAt: null, planningConfirmation: null }).where(eq(system.id, systemId));
    const outcome = await deliver(db, openPr());
    expect(outcome.detail).toContain("blocked:");
    expect(await columnOf(db, systemId)).toBe(active.id);
    const rows = await notices(db, "automation.blocked");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(p.owner.userId);
  });

  it("leaves a draft pull request alone", async () => {
    const { db, systemId, boardId } = await setup({ reviewOnOpen: true });
    const active = await moveTo(db, systemId, boardId, "active");
    await deliver(db, openPr({ draft: true }));
    expect(await columnOf(db, systemId)).toBe(active.id);
  });
});
