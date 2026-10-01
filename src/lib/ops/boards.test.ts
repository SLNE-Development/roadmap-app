import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { changeLog, columnRule, system, type ColumnCategory } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { columnRuleViolation, createBoard, listBoards, setBoardCardFields, setBoardColumns, setColumnRules, updateBoard } from "./boards";
import { ForbiddenError, InvalidError } from "./errors";
import { findBoard } from "./lookup";

describe("columnRuleViolation", () => {
  it("demands exactly one planning column and at least one done column", () => {
    const col = (name: string, category: ColumnCategory) => ({ name, category });
    expect(columnRuleViolation([col("A", "planning"), col("B", "done")])).toBeNull();
    expect(columnRuleViolation([col("A", "todo"), col("B", "done")])).toBe("A board needs exactly one planning column; this has 0.");
    expect(columnRuleViolation([col("A", "planning"), col("B", "planning"), col("C", "done")])).toMatch(/has 2/);
    expect(columnRuleViolation([col("A", "planning"), col("B", "todo")])).toBe("A board needs at least one done column.");
  });

  it("demands unique names, ignoring case and surrounding space", () => {
    expect(columnRuleViolation([{ name: "Review", category: "planning" }, { name: " review ", category: "done" }])).toBe(
      'Column names must be unique on a board; "review" appears twice.',
    );
  });
});

describe("boards", () => {
  it("creates boards with default columns, in order, owner only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    await expect(createBoard(db, editor, slug, { slug: "art", name: "Art" })).rejects.toMatchObject({ status: 403 });
    await expect(createBoard(db, owner, slug, { slug: "building", name: "Again" })).rejects.toMatchObject({
      status: 409,
      message: "Board slug building is taken in this project.",
    });
    const boards = await listBoards(db, editor, slug);
    expect(boards.map((b) => b.slug)).toEqual(["development", "building"]);
    expect(boards[1].columns).toHaveLength(6);
    await updateBoard(db, owner, slug, "building", { name: "Map building" });
    expect((await listBoards(db, owner, slug))[1].name).toBe("Map building");
  });

  it("logs a position change when the sort order moves", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await updateBoard(db, owner, slug, "development", { sortOrder: 3 });
    const rows = await db.select().from(changeLog).where(and(eq(changeLog.projectId, projectId), eq(changeLog.field, "position")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "board", field: "position", oldValue: "1", newValue: "4" });
  });
});

describe("setBoardColumns", () => {
  it("renames, reorders, adds and removes columns", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const before = await findBoard(db, projectId, "development");
    const [planning, , , , , done] = before.columns;
    const result = await setBoardColumns(db, owner, slug, "development", {
      columns: [
        { id: planning.id, name: "Idea", category: "planning" },
        { name: "Sketch", category: "active" },
        { id: done.id, name: "Shipped", category: "done" },
      ],
    });
    expect(result.columns.map((c) => [c.name, c.category, c.sortOrder])).toEqual([
      ["Idea", "planning", 0],
      ["Sketch", "active", 1],
      ["Shipped", "done", 2],
    ]);
    expect(result.columns[0].id).toBe(planning.id);
  });

  it("rejects duplicate column names", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { name: "Plan", category: "planning" },
          { name: "Review", category: "active" },
          { name: "review", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Column names must be unique on a board; "review" appears twice.' });
  });

  it("writes no log row when the columns are unchanged", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const dev = await findBoard(db, projectId, "development");
    const count = async () => (await db.select().from(changeLog)).length;
    const before = await count();
    await setBoardColumns(db, owner, slug, "development", { columns: dev.columns.map((c) => ({ id: c.id, name: c.name, category: c.category })) });
    expect(await count()).toBe(before);
  });

  it("enforces the board rules", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { name: "A", category: "todo" },
          { name: "B", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: "A board needs exactly one planning column; this has 0." });
  });

  it("refuses to drop a column that still holds systems", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const b = await findBoard(db, projectId, "development");
    await db.insert(system).values({ id: "s1", projectId, boardId: b.id, columnId: b.columns[1].id, slug: "s", title: "S", sortOrder: 0 });
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: b.columns[0].id, name: "Planning", category: "planning" },
          { id: b.columns[5].id, name: "Done", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Column "Todo" still holds 1 system; move it first.' });
  });

  it("refuses to turn the planning column into another category while it holds unplanned systems", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const b = await findBoard(db, projectId, "development");
    await db.insert(system).values({ id: "s1", projectId, boardId: b.id, columnId: b.columns[0].id, slug: "s", title: "S", sortOrder: 0 });
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: b.columns[0].id, name: "Planning", category: "todo" },
          { name: "New planning", category: "planning" },
          { id: b.columns[5].id, name: "Done", category: "done" },
          ...b.columns.slice(1, 5).map((c) => ({ id: c.id, name: c.name, category: c.category })),
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Column "Planning" holds systems that are still in planning; it must stay the planning column.' });
  });

  it("rejects column ids from another board", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const other = await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    const dev = await findBoard(db, projectId, "development");
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: other.columns[0].id, name: "Planning", category: "planning" },
          { id: dev.columns[5].id, name: "Done", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, message: `Column ${other.columns[0].id} is not on board development.` });
  });

  it("rejects a column id listed twice", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const dev = await findBoard(db, projectId, "development");
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: dev.columns[0].id, name: "Planning", category: "planning" },
          { id: dev.columns[0].id, name: "Again", category: "todo" },
          { id: dev.columns[5].id, name: "Done", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, message: `Column ${dev.columns[0].id} is listed twice.` });
  });

  it("keeps exactly one planning column under concurrent edits", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const dev = await findBoard(db, projectId, "development");
    const done = { id: dev.columns[5].id, name: "Done", category: "done" as const };
    const replace = (name: string) =>
      setBoardColumns(db, owner, slug, "development", {
        columns: [{ name, category: "planning" }, done],
      });
    await Promise.allSettled([replace("First"), replace("Second")]);
    const after = await findBoard(db, projectId, "development");
    expect(after.columns.filter((c) => c.category === "planning")).toHaveLength(1);
  });
});

describe("setBoardCardFields", () => {
  it("lets an owner choose the fields, logs one change and refuses editors and unknown values", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    expect((await listBoards(db, owner, slug))[0].cardFields).toEqual(["domain", "priority", "blocked", "tasks", "owner"]);
    await expect(setBoardCardFields(db, owner, slug, "development", { fields: ["phase", "questions"] })).resolves.toEqual(["phase", "questions"]);
    expect((await listBoards(db, editor, slug))[0].cardFields).toEqual(["phase", "questions"]);
    await expect(setBoardCardFields(db, editor, slug, "development", { fields: ["owner"] })).rejects.toMatchObject({ status: 403 });
    await expect(setBoardCardFields(db, owner, slug, "development", { fields: ["nope"] })).rejects.toMatchObject({
      status: 400,
      message: "Unknown card field nope.",
    });
    const rows = await db.select().from(changeLog).where(and(eq(changeLog.projectId, projectId), eq(changeLog.field, "cardFields")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "board", oldValue: "domain,priority,blocked,tasks,owner", newValue: "phase,questions" });
  });
});

describe("setColumnRules", () => {
  it("lets an owner set a column's rules, which listBoards returns in order, and logs them", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await setColumnRules(db, owner, slug, "development", { column: "Done", rules: [{ rule: "all-tasks-done" }, { rule: "update-within-days", param: 3 }] });
    const done = (await listBoards(db, owner, slug))[0].columns.find((c) => c.name === "Done");
    expect(done?.rules).toEqual([
      { rule: "all-tasks-done", param: null },
      { rule: "update-within-days", param: 3 },
    ]);
    expect((await listBoards(db, owner, slug))[0].columns.find((c) => c.name === "Todo")?.rules).toEqual([]);
    const rows = await db.select().from(changeLog).where(and(eq(changeLog.projectId, projectId), eq(changeLog.field, "rules")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "column", entityId: done?.id, newValue: "all-tasks-done, update-within-days(3)" });
  });

  it("refuses unknown rules, bad params, the planning column and editors", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const set = (rules: { rule: string; param?: number | null }[], column = "Done", actor = owner) =>
      setColumnRules(db, actor, slug, "development", { column, rules });
    await expect(set([{ rule: "nope" }])).rejects.toMatchObject({
      status: 400,
      message: "Unknown rule nope. Known rules: all-tasks-done, no-open-questions, spec-exists, plan-covers-tasks, update-within-days, adr-linked.",
    });
    await expect(set([{ rule: "update-within-days", param: 61 }])).rejects.toBeInstanceOf(InvalidError);
    await expect(set([{ rule: "update-within-days", param: 0 }])).rejects.toBeInstanceOf(InvalidError);
    await expect(set([{ rule: "spec-exists", param: 2 }])).rejects.toBeInstanceOf(InvalidError);
    await expect(set([{ rule: "spec-exists" }], "Planning")).rejects.toMatchObject({
      status: 400,
      message: "The planning column cannot have entry rules; the planning interview is its gate.",
    });
    await expect(set([{ rule: "spec-exists" }], "Done", editor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("removes the rules when their column is deleted", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const board = await findBoard(db, (await listBoards(db, owner, slug))[0].projectId, "development");
    await setBoardColumns(db, owner, slug, "development", {
      columns: [...board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category })), { name: "Shipped", category: "done" as const }],
    });
    await setColumnRules(db, owner, slug, "development", { column: "Shipped", rules: [{ rule: "spec-exists" }] });
    expect(await db.select().from(columnRule)).toHaveLength(1);
    await setBoardColumns(db, owner, slug, "development", { columns: board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category })) });
    expect(await db.select().from(columnRule)).toHaveLength(0);
  });
});
