import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createBoard } from "./boards";
import { messageOf, statusOf } from "./errors";
import { addPlanningRound, answerPlanningItems } from "./planning";
import { addQuestion, setQuestionResolved } from "./questions";
import { addTask, updateTask } from "./tasks";
import { setSystemArchived } from "./archive";
import { createDomain, createPhase } from "./structure";
import { createSystem, getSystem, listSystems, moveSystem, updateSystem, updateSystems } from "./systems";

describe("createSystem", () => {
  it("puts a new system into the planning column of the first board by default", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "launcher", title: "Launcher" });
    const detail = await getSystem(db, owner, slug, "launcher");
    expect([detail.board.slug, detail.column.category, detail.system.priority]).toEqual(["development", "planning", "Later"]);
  });

  it("uses the named board and rejects taken slugs and foreign domains", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreignDomain = await createDomain(db, other.owner, "other", { name: "X" });
    await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    await createSystem(db, owner, slug, { slug: "spawn", title: "Spawn", board: "building" });
    expect((await getSystem(db, owner, slug, "spawn")).board.slug).toBe("building");
    await expect(createSystem(db, owner, slug, { slug: "spawn", title: "Again" })).rejects.toMatchObject({
      status: 409,
      message: "System slug spawn is taken in this project.",
    });
    await expect(createSystem(db, owner, slug, { slug: "x", title: "X", domainId: foreignDomain.id })).rejects.toMatchObject({
      status: 400,
      message: `Unknown domain ${foreignDomain.id}.`,
    });
  });

  it("rejects empty domain and owner ids as invalid input", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const statusOfFailure = (run: Promise<unknown>) => run.then(() => 0, statusOf);
    expect(await statusOfFailure(createSystem(db, owner, slug, { slug: "s", title: "S", domainId: "" }))).toBe(400);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    expect(await statusOfFailure(updateSystem(db, owner, slug, "s", { ownerUserId: "" }))).toBe(400);
  });

  it("needs the editor role", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(createSystem(db, viewer, slug, { slug: "x", title: "X" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("listSystems", () => {
  it("filters by board, column category and owner", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B", board: "building" });
    await updateSystem(db, owner, slug, "b", { ownerUserId: owner.userId });
    await completePlanningFixture(db, b.id);
    await moveSystem(db, owner, slug, "b", { column: "todo" });
    expect((await listSystems(db, owner, slug, { board: "building" })).map((s) => s.slug)).toEqual(["b"]);
    expect((await listSystems(db, owner, slug, { category: "planning" })).map((s) => s.slug)).toEqual(["a"]);
    expect((await listSystems(db, owner, slug, { owner: "none" })).map((s) => s.slug)).toEqual(["a"]);
    const [row] = await listSystems(db, owner, slug, { owner: owner.userId });
    expect(row).toMatchObject({ slug: "b", ownerName: "Owner", columnName: "Todo", planningComplete: true, tasksTotal: 0 });
  });

  it("counts planning rounds and areas with an answered or accepted-risk item", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "fresh", title: "Fresh" });
    await createSystem(db, owner, slug, { slug: "busy", title: "Busy" });
    const r1 = await addPlanningRound(db, owner, slug, "busy", {
      items: [
        { area: "failure-modes", question: "What breaks?", isRisk: true },
        { area: "scope", question: "In scope?" },
        { area: "scope", question: "Out of scope?" },
      ],
    });
    const r2 = await addPlanningRound(db, owner, slug, "busy", { items: [{ area: "dependencies", question: "Needs?" }] });
    await answerPlanningItems(db, owner, slug, "busy", {
      answers: [
        { itemId: r1.itemIds[0], answer: "Accepted", status: "accepted-risk" },
        { itemId: r1.itemIds[1], answer: "Yes" },
        { itemId: r1.itemIds[2], answer: "No" },
      ],
    });
    expect(r2.itemIds).toHaveLength(1);
    const rows = await listSystems(db, owner, slug);
    expect(rows.map((s) => [s.slug, s.planningRounds, s.planningAreasCovered])).toEqual([
      ["fresh", 0, 0],
      ["busy", 2, 2],
    ]);
  });

  it("counts open questions and estimate points per system", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const created = await createSystem(db, owner, slug, { slug: "busy", title: "Busy" });
    await completePlanningFixture(db, created.id);
    await createSystem(db, owner, slug, { slug: "quiet", title: "Quiet" });
    await addQuestion(db, owner, slug, { title: "One?", system: "busy" });
    await addQuestion(db, owner, slug, { title: "Two?", system: "busy" });
    const resolved = await addQuestion(db, owner, slug, { title: "Three?", system: "busy" });
    await setQuestionResolved(db, owner, slug, resolved.id, true);
    await addQuestion(db, owner, slug, { title: "Elsewhere?", system: "quiet" });
    await addTask(db, owner, slug, "busy", { title: "m", estimate: "M" });
    const l = await addTask(db, owner, slug, "busy", { title: "l", estimate: "L" });
    const s = await addTask(db, owner, slug, "busy", { title: "s", estimate: "S" });
    await updateTask(db, owner, l.id, { state: "done" });
    await updateTask(db, owner, s.id, { state: "doing" });
    const [busy, quiet] = await listSystems(db, owner, slug);
    expect(busy).toMatchObject({ slug: "busy", openQuestions: 2, points: 12, pointsDone: 8 });
    expect(quiet).toMatchObject({ slug: "quiet", openQuestions: 1 });
  });
});

describe("moveSystem", () => {
  it("keeps a system in planning until planning is complete", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(moveSystem(db, owner, slug, "s", { column: "In progress" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("System s is still in planning."),
    });
  });

  it("moves by column name or id after planning and logs the move", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    await moveSystem(db, owner, slug, "s", { column: "in progress" });
    const detail = await getSystem(db, owner, slug, "s");
    expect(detail.column.name).toBe("In progress");
    await moveSystem(db, owner, slug, "s", { column: detail.board.columns[5].id });
    expect((await getSystem(db, owner, slug, "s")).column.name).toBe("Done");
    const moves = (await db.select().from(changeLog)).filter((c) => c.field === "column");
    expect(moves.map((m) => m.newValue)).toEqual(["Development / In progress", "Development / Done"]);
    expect(moves.every((m) => m.systemId === s.id)).toBe(true);
  });

  it("makes the mover owner when an unowned system enters an active column, never replacing an owner", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await completePlanningFixture(db, a.id);
    await completePlanningFixture(db, b.id);
    await moveSystem(db, editor, slug, "a", { column: "Todo" });
    expect((await getSystem(db, owner, slug, "a")).ownerName).toBeNull();
    await moveSystem(db, editor, slug, "a", { column: "In progress" });
    expect((await getSystem(db, owner, slug, "a")).ownerName).toBe("editor member");
    await updateSystem(db, owner, slug, "b", { ownerUserId: owner.userId });
    await moveSystem(db, editor, slug, "b", { column: "In progress" });
    expect((await getSystem(db, owner, slug, "b")).ownerName).toBe("Owner");
  });

  it("only accepts columns of the target board", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const building = await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    await expect(moveSystem(db, owner, slug, "s", { column: building.columns[1].id })).rejects.toMatchObject({
      status: 400,
      message: 'Board development has no column "' + building.columns[1].id + '". Columns: Planning, Todo, In progress, Review, Blocked, Done.',
    });
    await moveSystem(db, owner, slug, "s", { board: "building", column: building.columns[1].id });
    expect((await getSystem(db, owner, slug, "s")).board.slug).toBe("building");
  });
});

describe("updateSystem", () => {
  it("only assigns project members as owner and logs owner changes by name", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const outsider = await insertUser(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(updateSystem(db, owner, slug, "s", { ownerUserId: outsider.userId })).rejects.toMatchObject({
      status: 400,
      message: `User ${outsider.userId} is not a member of this project.`,
    });
    await updateSystem(db, owner, slug, "s", { ownerUserId: owner.userId, notes: "n", priority: "MVP" });
    const fields = (await db.select().from(changeLog)).filter((c) => c.entity === "system").map((c) => [c.field, c.newValue]);
    expect(fields).toEqual([
      ["created", "S"],
      ["priority", "MVP"],
      ["owner", "Owner"],
      ["notes", "n"],
    ]);
  });
});

describe("updateSystems", () => {
  async function three(db: Awaited<ReturnType<typeof createTestDb>>, owner: Awaited<ReturnType<typeof createProjectFixture>>["owner"], slug: string) {
    const rows = [];
    for (const key of ["a", "b", "c"]) rows.push(await createSystem(db, owner, slug, { slug: key, title: key.toUpperCase() }));
    return rows;
  }

  it("sets the phase on every listed system and logs each change", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await three(db, owner, slug);
    const alpha = await createPhase(db, owner, slug, { name: "Alpha" });
    const result = await updateSystems(db, owner, slug, { systems: ["a", "b", "c", "a"], patch: { phaseId: alpha.id } });
    expect(result).toEqual({ updated: ["a", "b", "c"] });
    expect((await listSystems(db, owner, slug)).map((s) => s.phaseId)).toEqual([alpha.id, alpha.id, alpha.id]);
    expect((await db.select().from(changeLog)).filter((c) => c.field === "phaseId")).toHaveLength(3);
  });

  it("changes nothing and names the failing system when one cannot move out of planning", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const [a, b] = await three(db, owner, slug);
    await completePlanningFixture(db, a.id);
    await completePlanningFixture(db, b.id);
    const error = await updateSystems(db, owner, slug, { systems: ["a", "b", "c"], patch: { move: { column: "Todo" } } }).catch((e) => e);
    expect(statusOf(error)).toBe(409);
    expect(error.message).toMatch(/^Nothing was changed\. 1 systems failed: c: System c is still in planning\./);
    expect((await listSystems(db, owner, slug)).map((s) => s.columnName)).toEqual(["Planning", "Planning", "Planning"]);
    expect((await db.select().from(changeLog)).filter((c) => c.field === "column")).toHaveLength(0);
  });

  it("names every failing system, including an archived one", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await three(db, owner, slug);
    await setSystemArchived(db, owner, slug, "b", true);
    const error = await updateSystems(db, owner, slug, { systems: ["a", "b", "c"], patch: { priority: "MVP", move: { column: "Todo" } } }).catch((e) => e);
    expect(error.message).toMatch(/^Nothing was changed\. 3 systems failed: a: .*; b: System b is archived.*; c: /);
    expect((await db.select().from(changeLog)).filter((c) => c.field === "priority")).toHaveLength(0);
  });

  it("rejects a non-member owner with a 400 and changes nothing", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await three(db, owner, slug);
    const outsider = await insertUser(db);
    const error = await updateSystems(db, owner, slug, { systems: ["a", "b"], patch: { ownerUserId: outsider.userId } }).catch((e) => e);
    expect(statusOf(error)).toBe(400);
    expect(error.message).toContain("Nothing was changed. 2 systems failed:");
    expect((await listSystems(db, owner, slug)).map((s) => s.ownerUserId)).toEqual([null, null, null]);
  });

  it("treats an unknown slug as a failure", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await three(db, owner, slug);
    const error = await updateSystems(db, owner, slug, { systems: ["a", "nope"], patch: { priority: "MVP" } }).catch((e) => e);
    expect(statusOf(error)).toBe(409);
    expect(error.message).toBe("Nothing was changed. 1 systems failed: nope: not found");
    expect((await listSystems(db, owner, slug)).map((s) => s.priority)).toEqual(["Later", "Later", "Later"]);
  });

  it("needs the editor role and at least one change", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await three(db, owner, slug);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(updateSystems(db, viewer, slug, { systems: ["a"], patch: { priority: "MVP" } })).rejects.toMatchObject({ status: 403 });
    const error = await updateSystems(db, owner, slug, { systems: ["a"], patch: {} }).catch((e) => e);
    expect(statusOf(error)).toBe(400);
    expect(messageOf(error)).toContain("Choose at least one change.");
  });
});
