import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { createAdr, getAdr, updateAdr } from "./adrs";
import { archiveProject, restoreProject, setSystemArchived } from "./archive";
import { listBlockedTasks } from "./blocked";
import { setBoardColumns } from "./boards";
import { addCheck } from "./checks";
import { setDependencies } from "./dependencies";
import { writeSpec } from "./documents";
import { ConflictError, ForbiddenError } from "./errors";
import { createCustomField, setSystemFields } from "./fields";
import { findBoard } from "./lookup";
import { addPlanningRound } from "./planning";
import { getProject, listProjects } from "./projects";
import { addQuestion } from "./questions";
import { phaseRollups } from "./rollups";
import { projectNav, projectSummaries } from "./summaries";
import { createSystem, getSystem, listSystems, moveSystem, updateSystem } from "./systems";
import { addTask, moveTask, updateTask } from "./tasks";
import { postUpdate } from "./updates";

describe("archive", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await createSystem(db, owner, slug, { slug: "other", title: "Other" });
    const t = await addTask(db, owner, slug, "s", { title: "T" });
    return { db, owner, slug, projectId, taskId: t.id };
  }

  const archived = { name: "ConflictError", message: expect.stringContaining("archived") };

  it("hides an archived system from the default listing and filters by archived", async () => {
    const { db, owner, slug } = await setup();
    await setSystemArchived(db, owner, slug, "s", true);
    expect((await listSystems(db, owner, slug)).map((s) => s.slug)).toEqual(["other"]);
    const only = await listSystems(db, owner, slug, { archived: "only" });
    expect(only.map((s) => s.slug)).toEqual(["s"]);
    expect(only[0].archivedAt).toBeInstanceOf(Date);
    expect((await listSystems(db, owner, slug, { archived: "include" })).map((s) => s.slug).sort()).toEqual(["other", "s"]);
  });

  it("refuses writes to an archived system on every path, while reads still work", async () => {
    const { db, owner, slug, taskId } = await setup();
    await setSystemArchived(db, owner, slug, "s", true);
    await expect(updateSystem(db, owner, slug, "s", { title: "X" })).rejects.toMatchObject(archived);
    await expect(addTask(db, owner, slug, "s", { title: "U" })).rejects.toMatchObject(archived);
    await expect(updateTask(db, owner, taskId, { title: "X" })).rejects.toMatchObject(archived);
    await expect(moveSystem(db, owner, slug, "s", { column: "Planning" })).rejects.toMatchObject(archived);
    await expect(writeSpec(db, owner, slug, "s", { body: "spec" })).rejects.toMatchObject(archived);
    await expect(updateSystem(db, owner, slug, "s", { title: "X" })).rejects.toBeInstanceOf(ConflictError);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const detail = await getSystem(db, viewer, slug, "s");
    expect(detail.system.archivedAt).toBeInstanceOf(Date);
    expect(detail.tasks.map((t) => t.title)).toEqual(["T"]);
  });

  it("refuses the other write paths into an archived system", async () => {
    const { db, owner, slug, taskId } = await setup();
    const other = await addTask(db, owner, slug, "other", { title: "O" });
    await createCustomField(db, owner, slug, { key: "risk", name: "Risk", type: "text" });
    await setSystemArchived(db, owner, slug, "s", true);
    await expect(addCheck(db, owner, taskId, { title: "C" })).rejects.toMatchObject(archived);
    await expect(moveTask(db, owner, taskId, { system: "other" })).rejects.toMatchObject(archived);
    await expect(moveTask(db, owner, other.id, { system: "s" })).rejects.toMatchObject(archived);
    await expect(setDependencies(db, owner, slug, "s", { dependsOn: ["other"] })).rejects.toMatchObject(archived);
    await expect(setSystemFields(db, owner, slug, "s", { values: { risk: "high" } })).rejects.toMatchObject(archived);
    await expect(postUpdate(db, owner, slug, "s", { summary: "Progress" })).rejects.toMatchObject(archived);
    await expect(addQuestion(db, owner, slug, { title: "Why?", system: "s" })).rejects.toMatchObject(archived);
    await expect(addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "What?" }] })).rejects.toMatchObject(archived);
  });

  it("leaves archived systems out of blocked tasks, rollups, home cards and dependency blocking", async () => {
    const { db, owner, slug, projectId, taskId } = await setup();
    await updateTask(db, owner, taskId, { state: "blocked", blockedReason: "waiting", estimate: "L" });
    await setDependencies(db, owner, slug, "other", { dependsOn: ["s"] });
    expect((await listSystems(db, owner, slug)).find((s) => s.slug === "other")?.blockedBy).toEqual(["s"]);
    await setSystemArchived(db, owner, slug, "s", true);
    expect(await listBlockedTasks(db, owner, slug)).toEqual([]);
    expect(await phaseRollups(db, owner, slug)).toEqual([]);
    expect((await projectSummaries(db, [projectId])).get(projectId)?.systems).toBe(1);
    const [listed] = await listSystems(db, owner, slug);
    expect(listed).toMatchObject({ slug: "other", dependsOn: ["s"], blockedBy: [] });
    const [shown] = await listSystems(db, owner, slug, { archived: "only" });
    expect(shown).toMatchObject({ slug: "s", points: 8, tasksBlocked: 1 });
  });

  it("restores a system so writes work again, logging both changes", async () => {
    const { db, owner, slug, taskId } = await setup();
    await setSystemArchived(db, owner, slug, "s", true);
    await setSystemArchived(db, owner, slug, "s", false);
    await updateSystem(db, owner, slug, "s", { title: "Renamed" });
    await updateTask(db, owner, taskId, { title: "Renamed" });
    const logged = await db.select().from(changeLog).where(eq(changeLog.field, "archived"));
    expect(logged.map((l) => [l.entity, l.newValue])).toEqual([
      ["system", "true"],
      ["system", "false"],
    ]);
  });

  it("archives and restores a project; only owners may, and writes in it are refused", async () => {
    const { db, owner, slug } = await setup();
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await expect(archiveProject(db, editor, slug)).rejects.toBeInstanceOf(ForbiddenError);
    await archiveProject(db, owner, slug);
    expect(await listProjects(db, owner)).toEqual([]);
    const only = await listProjects(db, owner, { archived: "only" });
    expect(only.map((p) => p.slug)).toEqual([slug]);
    expect(only[0].archivedAt).toBeInstanceOf(Date);
    await expect(createSystem(db, owner, slug, { slug: "new", title: "New" })).rejects.toMatchObject(archived);
    expect((await getProject(db, owner, slug)).project.archivedAt).toBeInstanceOf(Date);
    await restoreProject(db, owner, slug);
    expect((await listProjects(db, owner)).map((p) => p.slug)).toEqual([slug]);
    await createSystem(db, owner, slug, { slug: "new", title: "New" });
    const logged = await db.select().from(changeLog).where(eq(changeLog.field, "archived"));
    expect(logged.map((l) => [l.entity, l.newValue])).toEqual([
      ["project", "true"],
      ["project", "false"],
    ]);
  });

  it("refuses task-id writes in an archived project", async () => {
    const { db, owner, slug, taskId } = await setup();
    await archiveProject(db, owner, slug);
    await expect(updateTask(db, owner, taskId, { title: "X" })).rejects.toMatchObject(archived);
    await expect(addCheck(db, owner, taskId, { title: "C" })).rejects.toMatchObject(archived);
  });

  it("refuses a new ADR link to an archived system but keeps an existing one", async () => {
    const { db, owner, slug } = await setup();
    const adr = { title: "Use Postgres", context: "Why", decision: "What", alternatives: "None", consequences: "Some" };
    const { number } = await createAdr(db, owner, slug, { ...adr, systems: ["s"] });
    await setSystemArchived(db, owner, slug, "s", true);
    await expect(createAdr(db, owner, slug, { ...adr, systems: ["s"] })).rejects.toMatchObject({
      name: "ConflictError",
      message: "System s is archived; restore it first.",
    });
    await updateAdr(db, owner, slug, number, { decision: "Use Postgres 17", systems: ["s", "other"] });
    expect((await getAdr(db, owner, slug, number)).systems).toEqual(["other", "s"]);
  });

  it("says so when a removed column holds only archived systems", async () => {
    const { db, owner, slug, projectId } = await setup();
    const [other] = await listSystems(db, owner, slug, { board: "development" }).then((l) => l.filter((s) => s.slug === "other"));
    await completePlanningFixture(db, other.id);
    await moveSystem(db, owner, slug, "other", { column: "Todo" });
    await setSystemArchived(db, owner, slug, "other", true);
    const dev = await findBoard(db, projectId, "development");
    const kept = dev.columns.filter((c) => c.name !== "Todo").map((c) => ({ id: c.id, name: c.name, category: c.category }));
    await expect(setBoardColumns(db, owner, slug, "development", { columns: kept })).rejects.toMatchObject({
      status: 409,
      message: 'Column "Todo" still holds 1 archived system; restore and move it first.',
    });
  });

  it("keeps an archived system's slug taken", async () => {
    const { db, owner, slug } = await setup();
    await setSystemArchived(db, owner, slug, "s", true);
    await expect(createSystem(db, owner, slug, { slug: "s", title: "Again" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("leaves archived systems out of the project nav", async () => {
    const { db, owner, slug } = await setup();
    await setSystemArchived(db, owner, slug, "s", true);
    expect((await projectNav(db, owner, slug)).systems.map((s) => s.slug)).toEqual(["other"]);
  });
});
