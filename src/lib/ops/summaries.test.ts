import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { createAdr } from "./adrs";
import { listProjects } from "./projects";
import { addQuestion, answerQuestion } from "./questions";
import { projectNav, projectSummaries } from "./summaries";
import { createSystem } from "./systems";

describe("projectSummaries", () => {
  it("counts systems by category, open questions and the latest change per project", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "one");
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await addQuestion(db, owner, slug, { title: "Open?" });
    const { id } = await addQuestion(db, owner, slug, { title: "Done?" });
    await answerQuestion(db, owner, slug, { id, answer: "Yes" });
    const projects = await listProjects(db, owner);
    const summaries = await projectSummaries(db, projects.map((p) => p.id));
    const s = summaries.get(projects[0].id);
    expect(s?.systems).toBe(2);
    expect(s?.byCategory).toEqual({ planning: 2 });
    expect(s?.openQuestions).toBe(1);
    expect(s?.lastChange).toBeInstanceOf(Date);
  });

  it("returns zeroes for an empty project and nothing for no ids", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db, "empty");
    const [p] = await listProjects(db, owner);
    const s = (await projectSummaries(db, [p.id])).get(p.id);
    expect(s).toMatchObject({ systems: 0, byCategory: {}, openQuestions: 0 });
    expect((await projectSummaries(db, [])).size).toBe(0);
  });
});

describe("projectNav", () => {
  it("returns systems for navigation and the sidebar counts", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "nav");
    await addMemberFixture(db, owner, slug, "viewer");
    await createSystem(db, owner, slug, { slug: "b", title: "Beta" });
    await createSystem(db, owner, slug, { slug: "a", title: "Alpha" });
    await createAdr(db, owner, slug, { title: "T", context: "c", decision: "d", alternatives: "a", consequences: "q" });
    await addQuestion(db, owner, slug, { title: "Q?" });
    const nav = await projectNav(db, owner, slug);
    expect(nav.systems.map((s) => s.title)).toEqual(["Beta", "Alpha"]);
    expect(nav.systems[0].boardSlug).toBe("development");
    expect(nav).toMatchObject({ adrCount: 1, openQuestionCount: 1, memberCount: 2 });
  });

  it("hides projects the actor cannot see", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "private");
    const other = await addMemberFixture(db, owner, "private", "viewer");
    await expect(projectNav(db, other, slug)).resolves.toBeTruthy();
    const { owner: stranger } = await createProjectFixture(db, "elsewhere");
    await expect(projectNav(db, stranger, slug)).rejects.toThrow(/Unknown project/);
  });
});
