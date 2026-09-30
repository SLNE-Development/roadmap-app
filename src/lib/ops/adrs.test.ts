import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { acceptAdr, createAdr, formatAdrNumber, getAdr, listAdrs, supersedeAdr, updateAdr } from "./adrs";
import { createSystem } from "./systems";

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

  it("reports unknown numbers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(getAdr(db, owner, slug, 5)).rejects.toMatchObject({ status: 404, message: "Unknown ADR 0005." });
  });
});
