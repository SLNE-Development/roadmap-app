import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import type { Db } from "@/db/types";
import type { Actor } from "./actor";
import { createAdr } from "./adrs";
import { projectBrief } from "./brief";
import { setGlossaryTerm } from "./glossary";
import { addQuestion } from "./questions";
import { createSystem, moveSystem } from "./systems";

/** Creates a system with finished planning and moves it into `column`. */
async function systemIn(db: Db, owner: Actor, slug: string, name: string, column: string): Promise<void> {
  const row = await createSystem(db, owner, slug, { slug: name, title: `System ${name}` });
  await completePlanningFixture(db, row.id);
  await moveSystem(db, owner, slug, name, { column });
}

describe("projectBrief", () => {
  it("caps the length, cuts long lists and lists blocked systems and open questions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    for (let i = 0; i < 20; i++) await systemIn(db, owner, slug, `sys-${i}`, "In progress");
    await systemIn(db, owner, slug, "stuck", "Blocked");
    await addQuestion(db, owner, slug, { title: "Which queue", text: "Which queue do we use? ".repeat(10) });
    await createAdr(db, owner, slug, { title: "Use Valkey", context: "c", decision: "d", alternatives: "a", consequences: "q" });
    for (let i = 0; i < 40; i++) await setGlossaryTerm(db, owner, slug, { term: `Term ${i}`, definition: "x".repeat(300) });
    const brief = await projectBrief(db, owner, slug);
    expect(brief.length).toBeLessThanOrEqual(4000);
    expect(brief).toContain("# DEMO (demo)");
    expect(brief).toContain("…and 5 more");
    expect(brief).toMatch(/## Blocked\n- System stuck \(stuck\) · Blocked · unowned · 0 open/);
    expect(brief).toMatch(/## Open questions\n1 open, oldest first:\n- Q\S+: Which queue do we use\?/);
    expect(brief).toContain("- ADR-0001 Use Valkey");
  });

  it("lists the glossary while it fits and hides it from non-members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await setGlossaryTerm(db, owner, slug, { term: "Outbox", definition: "Queue table" });
    expect(await projectBrief(db, owner, slug)).toContain("## Glossary\n- Outbox: Queue table");
    const stranger = await insertUser(db, { name: "Stranger" });
    await expect(projectBrief(db, stranger, slug)).rejects.toMatchObject({ status: 404 });
  });
});
