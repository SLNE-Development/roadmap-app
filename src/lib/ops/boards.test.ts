import { describe, expect, it } from "vitest";
import { system } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { columnRuleViolation, createBoard, listBoards, setBoardColumns, updateBoard } from "./boards";
import { findBoard } from "./lookup";

describe("columnRuleViolation", () => {
  it("demands exactly one planning column and at least one done column", () => {
    expect(columnRuleViolation([{ category: "planning" }, { category: "done" }])).toBeNull();
    expect(columnRuleViolation([{ category: "todo" }, { category: "done" }])).toBe(
      "A board needs exactly one planning column; this has 0.",
    );
    expect(columnRuleViolation([{ category: "planning" }, { category: "planning" }, { category: "done" }])).toMatch(/has 2/);
    expect(columnRuleViolation([{ category: "planning" }, { category: "todo" }])).toBe("A board needs at least one done column.");
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
