import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { columnRuleViolation, DEFAULT_COLUMNS } from "./boards";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./projects";

describe("createProject", () => {
  it("makes the creator owner and adds a Development board with the default columns", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const detail = await getProject(db, owner, slug);
    expect(detail.role).toBe("owner");
    expect(detail.boards.map((b) => b.slug)).toEqual(["development"]);
    expect(detail.boards[0].columns.map((c) => [c.name, c.category])).toEqual(DEFAULT_COLUMNS.map((c) => [c.name, c.category]));
    expect(columnRuleViolation(detail.boards[0].columns)).toBeNull();
  });

  it("rejects a taken slug and non-http repository URLs", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db, "demo");
    await expect(createProject(db, owner, { slug: "demo", name: "Again" })).rejects.toMatchObject({
      status: 409,
      message: "Project slug demo is taken.",
    });
    await expect(createProject(db, owner, { slug: "x", name: "X", repoUrl: "javascript:alert(1)" })).rejects.toThrow(/repoUrl/);
    await expect(createProject(db, owner, { slug: "Bad Slug", name: "X" })).rejects.toThrow(/slug/);
  });
});

describe("listProjects", () => {
  it("shows members their projects and admins every project", async () => {
    const db = await createTestDb();
    await createProjectFixture(db, "alpha");
    const { owner } = await createProjectFixture(db, "beta");
    const admin = await insertUser(db, { isAdmin: true });
    expect((await listProjects(db, owner)).map((p) => [p.slug, p.role])).toEqual([["beta", "owner"]]);
    expect((await listProjects(db, admin)).map((p) => [p.slug, p.role])).toEqual([
      ["alpha", "admin"],
      ["beta", "admin"],
    ]);
  });
});

describe("updateProject and deleteProject", () => {
  it("logs each changed field and deletes everything with the project", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await updateProject(db, owner, slug, { name: "Renamed", repoUrl: "https://github.com/x/y" });
    const fields = (await db.select().from(changeLog)).map((c) => c.field);
    expect(fields).toEqual(["created", "name", "repoUrl"]);
    await deleteProject(db, owner, slug);
    expect(await listProjects(db, owner)).toEqual([]);
    expect(await db.select().from(changeLog)).toEqual([]);
  });
});
