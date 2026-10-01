import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, systemDependency } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { setDependencies } from "./dependencies";
import { getSystemOverview } from "./overview";
import { createSystem, listSystems, moveSystem } from "./systems";

describe("system dependencies", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const c = await createSystem(db, owner, slug, { slug: "c", title: "C" });
    const item = async (system: string) => (await listSystems(db, owner, slug)).find((s) => s.slug === system)!;
    return { db, owner, slug, a, b, c, item };
  }

  it("lists dependencies and the unfinished ones as blockedBy", async () => {
    const { db, owner, slug, b, item } = await setup();
    expect(await setDependencies(db, owner, slug, "a", { dependsOn: ["b"] })).toEqual({ dependsOn: ["b"] });
    expect(await item("a")).toMatchObject({ dependsOn: ["b"], blockedBy: ["b"] });
    await completePlanningFixture(db, b.id);
    await moveSystem(db, owner, slug, "b", { column: "Done" });
    expect(await item("a")).toMatchObject({ dependsOn: ["b"], blockedBy: [] });
  });

  it("filters startable systems", async () => {
    const { db, owner, slug, b } = await setup();
    await setDependencies(db, owner, slug, "a", { dependsOn: ["b"] });
    const slugs = async (startable: boolean) => (await listSystems(db, owner, slug, { startable })).map((s) => s.slug);
    expect(await slugs(true)).toEqual(["b", "c"]);
    expect(await slugs(false)).toEqual(["a"]);
    await completePlanningFixture(db, b.id);
    await moveSystem(db, owner, slug, "b", { column: "Done" });
    expect(await slugs(true)).toEqual(["a", "c"]);
    expect(await slugs(false)).toEqual([]);
  });

  it("rejects a cycle through three systems and writes nothing", async () => {
    const { db, owner, slug } = await setup();
    await setDependencies(db, owner, slug, "a", { dependsOn: ["b"] });
    await setDependencies(db, owner, slug, "b", { dependsOn: ["c"] });
    const logged = (await db.select().from(changeLog)).length;
    await expect(setDependencies(db, owner, slug, "c", { dependsOn: ["a"] })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("c → a → b → c"),
    });
    expect(await db.select().from(systemDependency)).toHaveLength(2);
    expect((await db.select().from(changeLog)).length).toBe(logged);
  });

  it("rejects self-dependencies and unknown or foreign systems", async () => {
    const { db, owner, slug } = await setup();
    const other = await createProjectFixture(db, "other");
    await createSystem(db, other.owner, "other", { slug: "x", title: "X" });
    await expect(setDependencies(db, owner, slug, "a", { dependsOn: ["a"] })).rejects.toMatchObject({ status: 400 });
    await expect(setDependencies(db, owner, slug, "a", { dependsOn: ["nope"] })).rejects.toMatchObject({ status: 404 });
    await expect(setDependencies(db, owner, slug, "a", { dependsOn: ["x"] })).rejects.toMatchObject({ status: 404 });
  });

  it("logs one deleted and one created entry when replacing the set", async () => {
    const { db, owner, slug, a, b, c } = await setup();
    await setDependencies(db, owner, slug, "a", { dependsOn: ["b"] });
    await db.delete(changeLog);
    await setDependencies(db, owner, slug, "a", { dependsOn: ["c"] });
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, "dependency"));
    expect(log.map((l) => [l.entityId, l.field, l.oldValue, l.newValue, l.systemId])).toEqual([
      [`${a.id}:${b.id}`, "deleted", "b", null, a.id],
      [`${a.id}:${c.id}`, "created", null, "c", a.id],
    ]);
    await setDependencies(db, owner, slug, "a", { dependsOn: ["c"] });
    expect(await db.select().from(changeLog).where(eq(changeLog.entity, "dependency"))).toHaveLength(2);
  });

  it("shows dependencies and dependents in the overview", async () => {
    const { db, owner, slug } = await setup();
    await setDependencies(db, owner, slug, "a", { dependsOn: ["b"] });
    const b = await getSystemOverview(db, owner, slug, "b");
    expect(b.dependencies.dependents).toEqual([{ slug: "a", title: "A", columnCategory: "planning" }]);
    expect(b.dependencies.dependsOn).toEqual([]);
    expect((await getSystemOverview(db, owner, slug, "a")).dependencies.dependsOn).toEqual([{ slug: "b", title: "B", columnCategory: "planning" }]);
  });

  it("is forbidden for viewers", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(setDependencies(db, viewer, slug, "a", { dependsOn: ["b"] })).rejects.toMatchObject({ status: 403 });
  });
});
