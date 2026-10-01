import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { acceptAdr, createAdr, formatAdrNumber, getAdr, linkableTasks, listAdrs, supersedeAdr, updateAdr } from "./adrs";
import { setSystemArchived } from "./archive";
import { addTask, deleteTask } from "./tasks";
import { createSystem, getSystem } from "./systems";

/** A complete ADR body with the given title. */
const body = (title: string) => ({
  title,
  context: "Why",
  decision: "What",
  alternatives: "Option B: faster, but…",
  consequences: "Gives, costs, follow-on, forecloses",
});

describe("ADRs", () => {
  it("formats numbers with four digits", () => {
    expect(formatAdrNumber(7)).toBe("0007");
    expect(formatAdrNumber(12345)).toBe("12345");
  });

  // PGlite serialises transactions, so this pins the numbering result, not the lock;
  // the project row lock is what makes it hold on Postgres.
  it("numbers ADRs per project, also under parallel creation", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const created = await Promise.all(["A", "B", "C"].map((t) => createAdr(db, owner, slug, body(t))));
    expect(created.map((c) => c.number).sort()).toEqual([1, 2, 3]);
    expect((await createAdr(db, other.owner, "other", body("X"))).number).toBe(1);
  });

  it("links systems and edits only while proposed", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { number } = await createAdr(db, owner, slug, { ...body("Use Postgres"), systems: ["s"] });
    await updateAdr(db, owner, slug, number, { decision: "Use Postgres 17" });
    await acceptAdr(db, owner, slug, number);
    const adr = await getAdr(db, owner, slug, number);
    expect(adr).toMatchObject({ status: "accepted", decision: "Use Postgres 17", systems: ["s"] });
    await expect(updateAdr(db, owner, slug, number, { decision: "SQLite" })).rejects.toMatchObject({
      status: 409,
      message: "ADR 0001 is accepted and can no longer be edited; write a new ADR that supersedes it.",
    });
    await expect(acceptAdr(db, owner, slug, number)).rejects.toMatchObject({ status: 409, message: "ADR 0001 is already accepted." });
    expect((await listAdrs(db, owner, slug, { system: "s" })).map((a) => a.number)).toEqual([1]);
  });

  it("supersedes an accepted ADR with another accepted one", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createAdr(db, owner, slug, body("Old"));
    await createAdr(db, owner, slug, body("New"));
    await acceptAdr(db, owner, slug, 1);
    await expect(supersedeAdr(db, owner, slug, { number: 1, by: 2 })).rejects.toMatchObject({
      status: 409,
      message: "ADR 0002 must be accepted before it can supersede another.",
    });
    await acceptAdr(db, owner, slug, 2);
    await supersedeAdr(db, owner, slug, { number: 1, by: 2 });
    const list = await listAdrs(db, owner, slug);
    expect(list.map((a) => [a.number, a.status, a.supersedes, a.supersededBy])).toEqual([
      [1, "superseded", null, 2],
      [2, "accepted", 1, null],
    ]);
    await expect(supersedeAdr(db, owner, slug, { number: 2, by: 2 })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects superseding with an ADR that already supersedes another", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    for (const t of ["One", "Two", "Three"]) await createAdr(db, owner, slug, body(t));
    for (const n of [1, 2, 3]) await acceptAdr(db, owner, slug, n);
    await supersedeAdr(db, owner, slug, { number: 1, by: 3 });
    await expect(supersedeAdr(db, owner, slug, { number: 2, by: 3 })).rejects.toMatchObject({
      status: 409,
      message: "ADR 0003 already supersedes another ADR.",
    });
    const list = await listAdrs(db, owner, slug);
    expect(list.map((a) => [a.number, a.status, a.supersedes, a.supersededBy])).toEqual([
      [1, "superseded", null, 3],
      [2, "accepted", null, null],
      [3, "accepted", 1, null],
    ]);
  });

  it("does not log an edit that changes nothing", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const { number } = await createAdr(db, owner, slug, body("A"));
    const count = async () => (await db.select().from(changeLog)).length;
    const before = await count();
    await updateAdr(db, owner, slug, number, {});
    expect(await count()).toBe(before);
  });

  it("logs only the fields an edit really changes", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const { number } = await createAdr(db, owner, slug, body("A"));
    const edits = async () => (await db.select().from(changeLog).where(eq(changeLog.field, "edited"))).map((r) => r.newValue);
    await updateAdr(db, owner, slug, number, { title: "A", decision: "Something else" });
    expect(await edits()).toEqual(["decision"]);
    await updateAdr(db, owner, slug, number, { ...body("A"), decision: "Something else", systems: [] });
    expect(await edits()).toEqual(["decision"]);
  });

  it("links tasks, also after acceptance, and keeps a history", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const t1 = (await addTask(db, owner, slug, "s", { title: "One" })).id;
    const t2 = (await addTask(db, owner, slug, "s", { title: "Two" })).id;
    const { number } = await createAdr(db, owner, slug, { ...body("Use Postgres"), tasks: [t1] });
    expect((await getAdr(db, owner, slug, number)).tasks).toEqual([{ id: t1, title: "One", state: "todo", systemSlug: "s" }]);
    expect((await getSystem(db, owner, slug, "s")).tasks.map((t) => t.adrs)).toEqual([[number], []]);
    await acceptAdr(db, owner, slug, number);
    await updateAdr(db, owner, slug, number, { tasks: [t1, t2] });
    await expect(updateAdr(db, owner, slug, number, { title: "x" })).rejects.toMatchObject({ status: 409 });
    const history = (await getAdr(db, owner, slug, number)).history;
    expect(history.map((h) => [h.field, h.oldValue, h.newValue])).toEqual([
      ["created", null, "ADR 0001: Use Postgres"],
      ["task", null, `#${t1}`],
      ["status", "proposed", "accepted"],
      ["task", null, `#${t2}`],
    ]);
    expect(history.every((h) => h.authorName !== null)).toBe(true);
    await updateAdr(db, owner, slug, number, { tasks: [t2] });
    expect((await getAdr(db, owner, slug, number)).history.at(-1)).toMatchObject({ field: "task", oldValue: `#${t1}`, newValue: null });
    await deleteTask(db, owner, t2);
    expect((await getAdr(db, owner, slug, number)).tasks).toEqual([]);
  });

  it("rejects a task of another project", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    await createSystem(db, other.owner, "other", { slug: "o", title: "O" });
    const foreign = (await addTask(db, other.owner, "other", "o", { title: "Foreign" })).id;
    await expect(createAdr(db, owner, slug, { ...body("A"), tasks: [foreign] })).rejects.toMatchObject({
      status: 404,
      message: `Unknown task ${foreign}.`,
    });
  });

  it("refuses a new link to a task of an archived system but keeps an existing one", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const kept = (await addTask(db, owner, slug, "s", { title: "Kept" })).id;
    const fresh = (await addTask(db, owner, slug, "s", { title: "Fresh" })).id;
    const { number } = await createAdr(db, owner, slug, { ...body("A"), tasks: [kept] });
    await setSystemArchived(db, owner, slug, "s", true);
    await expect(updateAdr(db, owner, slug, number, { tasks: [kept, fresh] })).rejects.toMatchObject({
      status: 409,
      message: "System s is archived; restore it first.",
    });
    await updateAdr(db, owner, slug, number, { tasks: [kept] });
    expect((await getAdr(db, owner, slug, number)).tasks.map((t) => t.id)).toEqual([kept]);
  });

  it("lists the project's linkable tasks", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const id = (await addTask(db, owner, slug, "s", { title: "One" })).id;
    expect(await linkableTasks(db, owner, slug)).toEqual([{ id, title: "One", systemSlug: "s" }]);
  });

  it("reports unknown numbers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(getAdr(db, owner, slug, 5)).rejects.toMatchObject({ status: 404, message: "Unknown ADR 0005." });
  });
});
