import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { allowedAccount, user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { setSystemArchived } from "./archive";
import { removeMember, setMember } from "./members";
import { createSystem, moveSystem, updateSystem } from "./systems";
import { addTask, updateTask } from "./tasks";
import { overloaded, teamWorkload, workloadProjects, type WorkloadRow } from "./workload";

/** An owner and Alice (editor) in `demo`, with Alice owning the system `api`. */
async function setup() {
  const db = await createTestDb();
  const { owner, slug } = await createProjectFixture(db);
  const alice = await addMemberFixture(db, owner, slug, "editor");
  const sys = await createSystem(db, owner, slug, { slug: "api", title: "API" });
  await completePlanningFixture(db, sys.id);
  await updateSystem(db, owner, slug, "api", { ownerUserId: alice.userId });
  return { db, owner, alice, slug };
}

const row = (userId: string, openPoints: number): WorkloadRow => ({
  userId,
  name: userId,
  image: null,
  systemsOwned: 0,
  systemsBlocked: 0,
  tasksDoing: 0,
  tasksBlocked: 0,
  openPoints,
  projects: [],
});

describe("teamWorkload", () => {
  it("sums open points and ignores done tasks", async () => {
    const { db, owner, alice, slug } = await setup();
    const m = await addTask(db, owner, slug, "api", { title: "M", estimate: "M" });
    const l = await addTask(db, owner, slug, "api", { title: "L", estimate: "L" });
    const d = await addTask(db, owner, slug, "api", { title: "Done", estimate: "S" });
    for (const t of [m, l, d]) await updateTask(db, owner, t.id, { ownerUserId: alice.userId });
    await updateTask(db, owner, m.id, { state: "doing" });
    await updateTask(db, owner, d.id, { state: "done" });
    const rows = await teamWorkload(db, owner, {});
    expect(rows[0]).toMatchObject({ userId: alice.userId, openPoints: 11, tasksDoing: 1, systemsOwned: 1 });
    expect(rows[0].projects).toEqual([{ slug, name: "DEMO", systems: 1, tasksDoing: 1 }]);
    expect(rows.map((r) => r.userId)).toEqual([alice.userId, owner.userId]);
  });

  it("counts blocked systems and tasks and skips done and archived systems", async () => {
    const { db, owner, alice, slug } = await setup();
    await moveSystem(db, owner, slug, "api", { column: "Blocked" });
    const t = await addTask(db, owner, slug, "api", { title: "T" });
    await updateTask(db, owner, t.id, { ownerUserId: alice.userId, state: "blocked", blockedReason: "x" });
    const done = await createSystem(db, owner, slug, { slug: "done", title: "Done" });
    await completePlanningFixture(db, done.id);
    await updateSystem(db, owner, slug, "done", { ownerUserId: alice.userId });
    await moveSystem(db, owner, slug, "done", { column: "Done" });
    await createSystem(db, owner, slug, { slug: "gone", title: "Gone" });
    await updateSystem(db, owner, slug, "gone", { ownerUserId: alice.userId });
    await setSystemArchived(db, owner, slug, "gone", true);
    const [a] = await teamWorkload(db, owner, {});
    expect(a).toMatchObject({ userId: alice.userId, systemsOwned: 1, systemsBlocked: 1, tasksBlocked: 1 });
  });

  it("shows members of shared projects only and never counts work in a project the actor is not in", async () => {
    const { db, owner, alice, slug } = await setup();
    const other = await createProjectFixture(db, "other");
    await setMember(db, other.owner, "other", { userId: alice.userId, role: "editor" });
    await createSystem(db, other.owner, "other", { slug: "hidden", title: "Hidden" });
    await updateSystem(db, other.owner, "other", "hidden", { ownerUserId: alice.userId });
    const stranger = await insertUser(db, { name: "Stranger" });
    await setMember(db, other.owner, "other", { userId: stranger.userId, role: "viewer" });
    const rows = await teamWorkload(db, owner, {});
    expect(rows.map((r) => r.userId).sort()).toEqual([alice.userId, owner.userId].sort());
    expect(rows.find((r) => r.userId === alice.userId)).toMatchObject({ systemsOwned: 1, projects: [{ slug }] });
    expect(await teamWorkload(db, other.owner, {})).toHaveLength(3);
  });

  it("answers 404 for a project the actor is not a member of, even for an admin", async () => {
    const { db, owner } = await setup();
    await createProjectFixture(db, "other");
    await expect(teamWorkload(db, owner, { project: "other" })).rejects.toMatchObject({ status: 404 });
    const admin = await insertUser(db, { name: "Admin", isAdmin: true });
    await expect(teamWorkload(db, admin, { project: "demo" })).rejects.toMatchObject({ status: 404 });
    expect(await teamWorkload(db, admin, {})).toEqual([]);
  });

  it("lists only member projects for an admin, with no rows from the others", async () => {
    const { db, slug } = await setup();
    const admin = await insertUser(db, { name: "Admin", isAdmin: true });
    await createProjectFixture(db, "b");
    const a = await createProjectFixture(db, "a");
    await setMember(db, a.owner, "a", { userId: admin.userId, role: "viewer" });
    expect(await workloadProjects(db, admin)).toEqual([{ slug: "a", name: "A" }]);
    await expect(teamWorkload(db, admin, { project: slug })).rejects.toMatchObject({ status: 404 });
    const rows = await teamWorkload(db, admin, { project: "a" });
    expect(rows.map((r) => r.userId).sort()).toEqual([a.owner.userId, admin.userId].sort());
  });

  it("filters to one project", async () => {
    const { db, owner, alice, slug } = await setup();
    const other = await createProjectFixture(db, "other");
    await setMember(db, other.owner, "other", { userId: owner.userId, role: "viewer" });
    await createSystem(db, other.owner, "other", { slug: "o", title: "O" });
    await updateSystem(db, other.owner, "other", "o", { ownerUserId: owner.userId });
    expect((await teamWorkload(db, owner, {})).find((r) => r.userId === owner.userId)?.systemsOwned).toBe(1);
    const rows = await teamWorkload(db, owner, { project: slug });
    expect(rows.find((r) => r.userId === owner.userId)?.systemsOwned).toBe(0);
    expect(rows.find((r) => r.userId === alice.userId)?.systemsOwned).toBe(1);
  });

  it("shows nothing for a removed member or a removed account", async () => {
    const { db, owner, alice, slug } = await setup();
    await removeMember(db, owner, slug, alice.userId);
    expect((await teamWorkload(db, owner, {})).map((r) => r.userId)).toEqual([owner.userId]);

    const bob = await addMemberFixture(db, owner, slug, "editor");
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await updateSystem(db, owner, slug, "b", { ownerUserId: bob.userId });
    expect((await teamWorkload(db, owner, {})).map((r) => r.userId)).toContain(bob.userId);
    const [u] = await db.select().from(user).where(eq(user.id, bob.userId));
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, u.discordId!));
    expect((await teamWorkload(db, owner, {})).map((r) => r.userId)).toEqual([owner.userId]);
  });

  it("sorts by points, then tasks doing, then name", async () => {
    const { db, owner, alice, slug } = await setup();
    const t = await addTask(db, owner, slug, "api", { title: "T", estimate: "S" });
    await updateTask(db, owner, t.id, { ownerUserId: owner.userId });
    const rows = await teamWorkload(db, owner, {});
    expect(rows.map((r) => r.userId)).toEqual([owner.userId, alice.userId]);
  });
});

describe("overloaded", () => {
  it("flags only people above twice the median", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 3), row("d", 10)];
    expect([...overloaded(rows)]).toEqual(["d"]);
  });

  it("flags nobody when the median is 0 or there are no rows", () => {
    expect(overloaded([row("a", 0), row("b", 0), row("c", 5)]).size).toBe(0);
    expect(overloaded([]).size).toBe(0);
  });
});
