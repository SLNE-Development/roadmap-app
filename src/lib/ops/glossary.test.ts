import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, glossaryTerm } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { deleteGlossaryTerm, glossaryBrief, listGlossary, setGlossaryTerm } from "./glossary";

describe("glossary", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    return { db, owner, slug, projectId };
  }

  it("upserts by case-insensitive term and logs the definition change", async () => {
    const { db, owner, slug } = await setup();
    const first = await setGlossaryTerm(db, owner, slug, { term: "Outbox", definition: "Queue table" });
    const second = await setGlossaryTerm(db, owner, slug, { term: "outbox", definition: "Pending events table", aliases: ["outbox table"] });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    const rows = await db.select().from(glossaryTerm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ definition: "Pending events table", aliases: ["outbox table"] });
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, "glossary"));
    expect(log.map((l) => [l.field, l.oldValue, l.newValue])).toEqual([
      ["created", null, "Outbox"],
      ["definition", "Queue table", "Pending events table"],
    ]);
  });

  it("keeps the aliases when an update leaves them out and gives a new term none", async () => {
    const { db, owner, slug } = await setup();
    await setGlossaryTerm(db, owner, slug, { term: "Outbox", definition: "Queue table", aliases: ["outbox table"] });
    await setGlossaryTerm(db, owner, slug, { term: "Outbox", definition: "Pending events table" });
    await setGlossaryTerm(db, owner, slug, { term: "Inbox", definition: "Incoming events" });
    expect(await listGlossary(db, owner, slug)).toMatchObject([
      { term: "Inbox", aliases: [] },
      { term: "Outbox", definition: "Pending events table", aliases: ["outbox table"] },
    ]);
  });

  it("refuses a viewer's write", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(setGlossaryTerm(db, viewer, slug, { term: "A", definition: "b" })).rejects.toMatchObject({ status: 403 });
  });

  it("deletes a term and rejects an unknown one", async () => {
    const { db, owner, slug } = await setup();
    await setGlossaryTerm(db, owner, slug, { term: "Outbox", definition: "Queue" });
    await deleteGlossaryTerm(db, owner, slug, "OUTBOX");
    expect(await listGlossary(db, owner, slug)).toEqual([]);
    expect((await db.select().from(changeLog).where(eq(changeLog.field, "deleted"))).map((l) => l.oldValue)).toEqual(["Outbox"]);
    await expect(deleteGlossaryTerm(db, owner, slug, "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("lists case-insensitively ordered", async () => {
    const { db, owner, slug } = await setup();
    for (const term of ["beta", "Alpha", "Gamma"]) await setGlossaryTerm(db, owner, slug, { term, definition: "d" });
    expect((await listGlossary(db, owner, slug)).map((t) => t.term)).toEqual(["Alpha", "beta", "Gamma"]);
  });

  it("returns the brief without access checks", async () => {
    const { db, owner, slug, projectId } = await setup();
    await setGlossaryTerm(db, owner, slug, { term: "Outbox", definition: "Queue" });
    expect(await glossaryBrief(db, projectId)).toEqual([{ term: "Outbox", definition: "Queue" }]);
  });
});
