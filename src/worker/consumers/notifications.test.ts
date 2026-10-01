import { asc, eq, gt, max } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { changeLog, notification, question, system } from "@/db/schema";
import type { Db } from "@/db/types";
import { memoryBus } from "@/lib/bus";
import { memoryKv } from "@/lib/kv";
import type { Actor } from "@/lib/ops/actor";
import { createAdr } from "@/lib/ops/adrs";
import { removeMember } from "@/lib/ops/members";
import { addPlanningRound } from "@/lib/ops/planning";
import { addQuestion, answerQuestion } from "@/lib/ops/questions";
import { createSystem, moveSystem, updateSystem } from "@/lib/ops/systems";
import { addTask, updateTask } from "@/lib/ops/tasks";
import { postUpdate } from "@/lib/ops/updates";
import { memoryQueue } from "@/lib/queue";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { createTestDb } from "@/test/db";
import type { WorkerDeps } from "../deps";
import { registeredFeedConsumers, type ChangeEvent } from "../feed";
import { handleNotificationEvents } from "./notifications";

function deps(db: Db): WorkerDeps {
  return { db, kv: memoryKv(), queue: () => memoryQueue(), bus: memoryBus(), now: () => new Date() };
}

/** A project with an owner, an editor and a system `core` owned by the owner, planning complete. */
async function setup() {
  const db = await createTestDb();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const editor = await addMemberFixture(db, owner, slug, "editor", "Eddie");
  const sys = await createSystem(db, owner, slug, { slug: "core", title: "Core" });
  await updateSystem(db, owner, slug, "core", { ownerUserId: owner.userId });
  await completePlanningFixture(db, sys.id);
  return { db, owner, editor, slug, projectId, systemId: sys.id };
}

/** Runs `fn` and returns the change-log rows it wrote. */
async function changes(db: Db, fn: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const [{ last }] = await db.select({ last: max(changeLog.id) }).from(changeLog);
  await fn();
  return db
    .select()
    .from(changeLog)
    .where(gt(changeLog.id, last ?? 0))
    .orderBy(asc(changeLog.id));
}

async function notices(db: Db) {
  return db
    .select({ userId: notification.userId, kind: notification.kind, title: notification.title, href: notification.href, actorName: notification.actorName, sourceKey: notification.sourceKey })
    .from(notification)
    .orderBy(asc(notification.createdAt));
}

async function handled(db: Db, fn: () => Promise<unknown>) {
  const events = await changes(db, fn);
  await handleNotificationEvents(events, deps(db));
  return { events, rows: await notices(db) };
}

describe("notifications consumer", () => {
  it("is registered as notifications", async () => {
    await import("./index");
    expect(registeredFeedConsumers().map((c) => c.name)).toContain("notifications");
  });

  it("tells the asker their question was answered", async () => {
    const { db, owner, editor, slug } = await setup();
    const { id } = await addQuestion(db, editor, slug, { title: "Which DB?" });
    const { events, rows } = await handled(db, () => answerQuestion(db, owner, slug, { id, answer: "Postgres" }));
    const answer = events.find((e) => e.field === "answer");
    expect(rows).toEqual([
      {
        userId: editor.userId,
        kind: "question.answered",
        title: "Owner answered your question",
        href: `/p/${slug}/questions#q-${id}`,
        actorName: "Owner",
        sourceKey: `cl:${answer?.id}`,
      },
    ]);
  });

  it("tells the system owner about a new question, blocking ones by name", async () => {
    const { db, owner, editor, slug } = await setup();
    const { rows } = await handled(db, async () => {
      await addQuestion(db, editor, slug, { title: "Q1", system: "core" });
      await addQuestion(db, editor, slug, { title: "Q2", system: "core", priority: "blocking" });
      await addQuestion(db, editor, slug, { title: "Q3" });
    });
    expect(rows.map((r) => [r.userId, r.kind, r.title])).toEqual([
      [owner.userId, "question.asked", "New question on Core"],
      [owner.userId, "question.asked", "Blocking question on Core"],
    ]);
    expect(rows[0].href).toMatch(new RegExp(`^/p/${slug}/questions#q-`));
  });

  it("tells the system owner about a planning round", async () => {
    const { db, owner, editor, slug } = await setup();
    await createSystem(db, owner, slug, { slug: "plan", title: "Plan" });
    await updateSystem(db, owner, slug, "plan", { ownerUserId: owner.userId });
    const { rows } = await handled(db, () => addPlanningRound(db, editor, slug, "plan", { items: [{ area: "scope", question: "What?" }] }));
    expect(rows).toMatchObject([
      { userId: owner.userId, kind: "planning.round", title: "Planning questions on Plan", href: `/p/${slug}/systems/plan?tab=planning`, actorName: "Eddie" },
    ]);
  });

  it("tells a new system owner, only while they still own it", async () => {
    const { db, owner, editor, slug } = await setup();
    const { rows } = await handled(db, () => updateSystem(db, owner, slug, "core", { ownerUserId: editor.userId }));
    expect(rows).toMatchObject([{ userId: editor.userId, kind: "system.assigned", title: "You own Core", href: `/p/${slug}/systems/core` }]);

    const events = await changes(db, async () => {
      await updateSystem(db, owner, slug, "core", { ownerUserId: owner.userId });
      await updateSystem(db, owner, slug, "core", { ownerUserId: editor.userId });
      await updateSystem(db, owner, slug, "core", { ownerUserId: null });
    });
    await handleNotificationEvents(events, deps(db));
    expect(await notices(db)).toHaveLength(1);
  });

  it("tells a new task owner", async () => {
    const { db, owner, editor, slug } = await setup();
    const { id } = await addTask(db, owner, slug, "core", { title: "Write schema" });
    const { rows } = await handled(db, () => updateTask(db, owner, id, { ownerUserId: editor.userId }));
    expect(rows).toMatchObject([
      { userId: editor.userId, kind: "task.assigned", title: `Task #${id} is yours: Write schema`, href: `/p/${slug}/systems/core#task-${id}` },
    ]);
  });

  it("tells the system owner and the task owner when a task is blocked", async () => {
    const { db, owner, editor, slug } = await setup();
    const third = await addMemberFixture(db, owner, slug, "editor", "Third");
    const { id } = await addTask(db, owner, slug, "core", { title: "Write schema" });
    await updateTask(db, owner, id, { ownerUserId: editor.userId });
    const { rows } = await handled(db, () => updateTask(db, third, id, { state: "blocked", blockedReason: "waiting on infra" }));
    expect(rows.map((r) => r.userId).sort()).toEqual([owner.userId, editor.userId].sort());
    expect(rows).toMatchObject([
      { kind: "task.blocked", title: `Task #${id} is blocked`, href: `/p/${slug}/systems/core#task-${id}` },
      { kind: "task.blocked", title: `Task #${id} is blocked`, href: `/p/${slug}/systems/core#task-${id}` },
    ]);
  });

  it("tells the system owner when the system is blocked or done", async () => {
    const { db, owner, editor, slug } = await setup();
    const { rows } = await handled(db, async () => {
      await moveSystem(db, editor, slug, "core", { column: "Todo" });
      await moveSystem(db, editor, slug, "core", { column: "Blocked" });
    });
    expect(rows).toMatchObject([{ userId: owner.userId, kind: "system.blocked", title: "Core is blocked", href: `/p/${slug}/systems/core` }]);
    const done = await handled(db, () => moveSystem(db, editor, slug, "core", { column: "Done" }));
    expect(done.rows.map((r) => [r.kind, r.title])).toEqual([
      ["system.blocked", "Core is blocked"],
      ["system.done", "Core is done"],
    ]);
  });

  it("tells the owners of linked systems about a proposed ADR", async () => {
    const { db, owner, editor, slug } = await setup();
    await createSystem(db, owner, slug, { slug: "api", title: "API" });
    await updateSystem(db, owner, slug, "api", { ownerUserId: editor.userId });
    const adr = { title: "Use Postgres", context: "c", decision: "d", alternatives: "a", consequences: "q", systems: ["core", "api"] };
    const { rows } = await handled(db, () => createAdr(db, editor, slug, adr));
    expect(rows).toMatchObject([{ userId: owner.userId, kind: "adr.proposed", title: "ADR-0001 proposed: Use Postgres", href: `/p/${slug}/adrs/1` }]);
  });

  it("tells the system owner about a posted update", async () => {
    const { db, owner, editor, slug } = await setup();
    const { rows } = await handled(db, () => postUpdate(db, editor, slug, "core", { summary: "Schema done" }));
    expect(rows).toMatchObject([{ userId: owner.userId, kind: "update.posted", title: "Update on Core", href: `/p/${slug}/systems/core` }]);
  });

  it("leaves only the mention when a new question mentions the system owner", async () => {
    const { db, owner, editor, slug } = await setup();
    const { rows } = await handled(db, () => addQuestion(db, editor, slug, { title: "Which DB?", system: "core", text: "@Owner what do you think?" }));
    expect(rows.map((r) => [r.userId, r.kind])).toEqual([[owner.userId, "mention"]]);
  });

  it("leaves only the mention when an answer mentions the asker", async () => {
    const { db, owner, editor, slug } = await setup();
    const { id } = await addQuestion(db, editor, slug, { title: "Which DB?" });
    const { rows } = await handled(db, () => answerQuestion(db, owner, slug, { id, answer: "@Eddie Postgres" }));
    expect(rows.map((r) => [r.userId, r.kind])).toEqual([[editor.userId, "mention"]]);
  });

  it("leaves only the mention when an update mentions the system owner", async () => {
    const { db, owner, editor, slug } = await setup();
    const { rows } = await handled(db, () => postUpdate(db, editor, slug, "core", { summary: "Schema done, @Owner please review" }));
    expect(rows.map((r) => [r.userId, r.kind])).toEqual([[owner.userId, "mention"]]);
  });

  it("tells the system owner about a question that moved to their system since", async () => {
    const { db, owner, editor, slug } = await setup();
    await createSystem(db, owner, slug, { slug: "api", title: "API" });
    await updateSystem(db, owner, slug, "api", { ownerUserId: editor.userId });
    const events = await changes(db, () => addQuestion(db, owner, slug, { title: "Which DB?", system: "core" }));
    await db.update(question).set({ systemId: (await db.select({ id: system.id }).from(system).where(eq(system.slug, "api")))[0].id });
    await handleNotificationEvents(events, deps(db));
    expect((await notices(db)).map((r) => [r.userId, r.kind, r.title])).toEqual([[editor.userId, "question.asked", "New question on API"]]);
  });

  it("creates nothing when the owner answers their own question", async () => {
    const { db, owner, slug } = await setup();
    const { id } = await addQuestion(db, owner, slug, { title: "Mine", system: "core" });
    const { rows } = await handled(db, () => answerQuestion(db, owner, slug, { id, answer: "Yes" }));
    expect(rows).toEqual([]);
  });

  it("tells the owner when their own agent asks a question", async () => {
    const { db, owner, slug } = await setup();
    const agent: Actor = { ...owner, agent: "Claude Code" };
    const { rows } = await handled(db, () => addQuestion(db, agent, slug, { title: "Which DB?", system: "core" }));
    expect(rows).toMatchObject([{ userId: owner.userId, kind: "question.asked", actorName: "Claude Code for Owner" }]);
  });

  it("leaves one row per recipient when the same events come twice", async () => {
    const { db, owner, editor, slug } = await setup();
    const third = await addMemberFixture(db, owner, slug, "editor", "Third");
    const { id } = await addTask(db, owner, slug, "core", { title: "T" });
    await updateTask(db, owner, id, { ownerUserId: editor.userId });
    const events = await changes(db, () => updateTask(db, third, id, { state: "blocked", blockedReason: "infra" }));
    await handleNotificationEvents(events, deps(db));
    await handleNotificationEvents(events, deps(db));
    expect(await notices(db)).toHaveLength(2);
  });

  it("skips a column event once the system has moved on", async () => {
    const { db, editor, slug } = await setup();
    const events = await changes(db, async () => {
      await moveSystem(db, editor, slug, "core", { column: "Blocked" });
      await moveSystem(db, editor, slug, "core", { column: "Todo" });
    });
    await handleNotificationEvents(events, deps(db));
    expect(await notices(db)).toEqual([]);
  });

  it("gives a removed member nothing", async () => {
    const { db, owner, editor, slug } = await setup();
    const { id } = await addQuestion(db, editor, slug, { title: "Which DB?" });
    const events = await changes(db, () => answerQuestion(db, owner, slug, { id, answer: "Postgres" }));
    await removeMember(db, owner, slug, editor.userId);
    await handleNotificationEvents(events, deps(db));
    expect(await notices(db)).toEqual([]);
  });

  it("handles 50 events with at most 10 queries", async () => {
    const { db, owner, slug } = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await addTask(db, owner, slug, "core", { title: `T${i}` })).id);
    const events = await changes(db, async () => {
      for (const id of ids) await updateTask(db, owner, id, { ownerUserId: owner.userId });
      for (const id of ids) await updateTask(db, owner, id, { state: "blocked", blockedReason: "infra" });
      for (const id of ids) await updateTask(db, owner, id, { state: "todo" });
      await moveSystem(db, owner, slug, "core", { column: "Todo" });
      await moveSystem(db, owner, slug, "core", { column: "Review" });
    });
    const asked = await changes(db, async () => {
      for (let i = 0; i < 25; i++) await addQuestion(db, owner, slug, { title: `Q${i}`, system: "core" });
    });
    const batch = [...events, ...asked].slice(0, 50);
    expect(batch).toHaveLength(50);
    const client = (db as unknown as { $client: PGlite }).$client;
    const query = vi.spyOn(client, "query");
    const exec = vi.spyOn(client, "exec");
    const transaction = vi.spyOn(client, "transaction");
    await handleNotificationEvents(batch, deps(db));
    const queries = query.mock.calls.length + exec.mock.calls.length + transaction.mock.calls.length;
    expect(queries).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(10);
    expect(await notices(db)).toEqual([]);
  });
});
