import { describe, expect, it } from "vitest";
import { changeLog, savedView } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { archiveProject } from "./archive";
import { removeMember, setMember } from "./members";
import { createSavedView, deleteSavedView, listSavedViews, renameSavedView, reorderSavedViews, setSavedViewPinned } from "./saved-views";

describe("saved views", () => {
  it("creates a project view and lists it with its project", async () => {
    const db = await createTestDb();
    const { owner, projectId } = await createProjectFixture(db);
    const row = await createSavedView(db, owner, { name: "By owner", path: "/p/demo/boards/development", query: "?lane=owner" });
    expect(row.query).toBe("lane=owner");
    expect(row.pinned).toBe(true);
    const list = await listSavedViews(db, owner, {});
    expect(list.map((v) => [v.id, v.projectId])).toEqual([[row.id, projectId]]);
  });

  it("stores global paths without a project", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    const row = await createSavedView(db, a, { name: "Load", path: "/workload", query: "project=demo" });
    expect(row.projectId).toBeNull();
  });

  it("rejects paths that cannot be saved", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    await expect(createSavedView(db, owner, { name: "x", path: "/p/demo/settings", query: "" })).rejects.toMatchObject({ status: 400 });
    await expect(createSavedView(db, owner, { name: "x", path: "https://evil.test/", query: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("answers 404 for a project the actor is not in", async () => {
    const db = await createTestDb();
    await createProjectFixture(db);
    const outsider = await insertUser(db);
    await expect(createSavedView(db, outsider, { name: "x", path: "/p/demo/systems", query: "" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a 31st view with the exact message", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    for (let i = 0; i < 30; i++) await createSavedView(db, a, { name: `v${i}`, path: "/", query: "" });
    await expect(createSavedView(db, a, { name: "one more", path: "/", query: "" })).rejects.toMatchObject({
      status: 409,
      message: "You can keep up to 30 views. Delete one first.",
    });
  });

  it("acts on the actor's own views only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await addMemberFixture(db, owner, slug, "viewer");
    const row = await createSavedView(db, owner, { name: "Mine", path: "/", query: "" });
    await expect(renameSavedView(db, other, row.id, "Stolen")).rejects.toMatchObject({ status: 404 });
    await expect(deleteSavedView(db, other, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(setSavedViewPinned(db, other, row.id, false)).rejects.toMatchObject({ status: 404 });
    await renameSavedView(db, owner, row.id, " Renamed ");
    await setSavedViewPinned(db, owner, row.id, false);
    const [v] = await listSavedViews(db, owner, {});
    expect([v.name, v.pinned]).toEqual(["Renamed", false]);
    await deleteSavedView(db, owner, row.id);
    expect(await listSavedViews(db, owner, {})).toEqual([]);
  });

  it("hides views of a project the actor left, and shows them again after re-adding", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const member = await addMemberFixture(db, owner, slug, "editor");
    await createSavedView(db, member, { name: "Mine", path: "/p/demo/systems", query: "q=a" });
    await createSavedView(db, member, { name: "Global", path: "/", query: "" });
    await removeMember(db, owner, slug, member.userId);
    expect((await listSavedViews(db, member, {})).map((v) => v.name)).toEqual(["Global"]);
    await setMember(db, owner, slug, { userId: member.userId, role: "viewer" });
    expect((await listSavedViews(db, member, {})).map((v) => v.name)).toEqual(["Mine", "Global"]);
  });

  it("leaves out views of archived projects", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSavedView(db, owner, { name: "Mine", path: "/p/demo/activity", query: "" });
    await archiveProject(db, owner, slug);
    expect(await listSavedViews(db, owner, {})).toEqual([]);
  });

  it("narrows to a project plus global views", async () => {
    const db = await createTestDb();
    const { owner, projectId } = await createProjectFixture(db);
    await createSavedView(db, owner, { name: "Global", path: "/", query: "" });
    await createSavedView(db, owner, { name: "Demo", path: "/p/demo/systems", query: "" });
    expect((await listSavedViews(db, owner, { projectId })).map((v) => v.name)).toEqual(["Global", "Demo"]);
  });

  it("reorders, and rejects an id the actor does not own", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    const x = await createSavedView(db, a, { name: "x", path: "/", query: "" });
    const y = await createSavedView(db, a, { name: "y", path: "/", query: "" });
    await reorderSavedViews(db, a, [y.id, x.id]);
    expect((await listSavedViews(db, a, {})).map((v) => v.name)).toEqual(["y", "x"]);
    await expect(reorderSavedViews(db, a, [y.id, "missing"])).rejects.toMatchObject({ status: 400 });
  });

  it("writes nothing to change_log", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    const before = await db.select().from(changeLog);
    const row = await createSavedView(db, a, { name: "x", path: "/", query: "" });
    await renameSavedView(db, a, row.id, "y");
    await setSavedViewPinned(db, a, row.id, false);
    await deleteSavedView(db, a, row.id);
    expect(await db.select().from(changeLog)).toHaveLength(before.length);
    expect(await db.select().from(savedView)).toEqual([]);
  });
});
