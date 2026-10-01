import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createAdr } from "./adrs";
import { recordCall } from "./agent-runs";
import { createBoard, updateBoard } from "./boards";
import { setMember } from "./members";
import { listProjects } from "./projects";
import { addQuestion, answerQuestion } from "./questions";
import { createRelease, shipRelease } from "./releases";
import { projectNav, projectSummaries } from "./summaries";
import { createSystem, moveSystem } from "./systems";
import { removeAllowedAccount } from "./users";

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

  it("rates a project with one blocked system out of three open ones as at risk", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "risky");
    for (const key of ["a", "b", "c"]) {
      const created = await createSystem(db, owner, slug, { slug: key, title: key.toUpperCase() });
      if (key === "a") {
        await completePlanningFixture(db, created.id);
        await moveSystem(db, owner, slug, "a", { column: "Blocked" });
      }
    }
    const [p] = await listProjects(db, owner);
    const s = (await projectSummaries(db, [p.id])).get(p.id);
    expect(s?.health).toEqual({ status: "at-risk", reasons: [{ code: "blocked", blocked: 1, open: 3 }] });
  });

  it("counts blocking questions and rates a quiet project as stalled", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "quiet");
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await addQuestion(db, owner, slug, { title: "Q?", priority: "blocking" });
    const [p] = await listProjects(db, owner);
    expect((await projectSummaries(db, [p.id])).get(p.id)?.health.reasons).toEqual([{ code: "blockingQuestions", count: 1 }]);
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await projectSummaries(db, [p.id], later)).get(p.id)?.health.status).toBe("stalled");
  });

  it("returns zeroes for an empty project and nothing for no ids", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db, "empty");
    const [p] = await listProjects(db, owner);
    const s = (await projectSummaries(db, [p.id])).get(p.id);
    expect(s).toMatchObject({ systems: 0, byCategory: {}, openQuestions: 0, health: { status: "empty", reasons: [] } });
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
    expect(nav).toMatchObject({ adrCount: 1, pageCount: 0, openQuestionCount: 1, memberCount: 2 });
  });

  it("counts the releases that are not shipped", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "rel");
    await createRelease(db, owner, slug, { slug: "a", name: "A" });
    await createRelease(db, owner, slug, { slug: "b", name: "B" });
    expect((await projectNav(db, owner, slug)).releaseCount).toBe(2);
    await shipRelease(db, owner, slug, "b", {});
    expect((await projectNav(db, owner, slug)).releaseCount).toBe(1);
  });

  it("counts the runs live within 2 minutes", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "live");
    const at = new Date("2026-10-01T10:00:00Z");
    await recordCall(db, { apiKeyId: "K", userId: owner.userId, agent: null, tool: "get_system", transport: "rest", input: { project: slug }, ok: true, status: 200, error: null, durationMs: 1, at });
    expect((await projectNav(db, owner, slug, new Date(at.getTime() + 60_000))).liveRuns).toBe(1);
    expect((await projectNav(db, owner, slug, new Date(at.getTime() + 180_000))).liveRuns).toBe(0);
  });

  it("lists systems in board order", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db, "order");
    await createBoard(db, owner, slug, { slug: "second", name: "Second" });
    await createSystem(db, owner, slug, { slug: "late", title: "Late", board: "second" });
    await createSystem(db, owner, slug, { slug: "early", title: "Early", board: "development" });
    await updateBoard(db, owner, slug, "development", { sortOrder: 0 });
    await updateBoard(db, owner, slug, "second", { sortOrder: 1 });
    expect((await projectNav(db, owner, slug)).systems.map((s) => s.title)).toEqual(["Early", "Late"]);
  });

  it("does not count removed accounts as members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const admin = await insertUser(db, { isAdmin: true });
    const gone = await insertUser(db, { discordId: "723456789012345678" });
    await setMember(db, owner, slug, { userId: gone.userId, role: "viewer" });
    await removeAllowedAccount(db, admin, "723456789012345678");
    expect((await projectNav(db, owner, slug)).memberCount).toBe(1);
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
