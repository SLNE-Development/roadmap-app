import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createBoard } from "./boards";
import { createDomain } from "./structure";
import { createSystem, getSystem, listSystems, moveSystem, updateSystem } from "./systems";

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
