import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import {
  createDomain,
  createPhase,
  deleteDomain,
  deletePhase,
  listDomains,
  listPhases,
  reorderDomains,
  reorderPhases,
  updateDomain,
  updatePhase,
} from "./structure";

describe("domains and phases", () => {
  it("creates, lists in order and deletes domains", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const police = await createDomain(db, editor, slug, { name: "Police" });
    await createDomain(db, editor, slug, { name: "Vehicles", description: "Cars" });
    expect((await listDomains(db, editor, slug)).map((d) => d.name)).toEqual(["Police", "Vehicles"]);
    await deleteDomain(db, editor, slug, police.id);
    expect((await listDomains(db, editor, slug)).map((d) => d.name)).toEqual(["Vehicles"]);
  });

  it("stores phase dependencies within the project only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreign = await createPhase(db, other.owner, "other", { name: "Foreign" });
    const p0 = await createPhase(db, owner, slug, { name: "P0", goal: "Boot" });
    const p1 = await createPhase(db, owner, slug, { name: "P1", dependsOn: [p0.id] });
    expect(p1.dependsOn).toEqual([p0.id]);
    await expect(createPhase(db, owner, slug, { name: "P2", dependsOn: [foreign.id] })).rejects.toMatchObject({
      status: 400,
      message: `Unknown phase ${foreign.id}.`,
    });
    await deletePhase(db, owner, slug, p0.id);
    expect((await listPhases(db, owner, slug)).map((p) => [p.name, p.dependsOn])).toEqual([["P1", []]]);
  });

  it("stores a repeated dependency once", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const p0 = await createPhase(db, owner, slug, { name: "P0" });
    const p1 = await createPhase(db, owner, slug, { name: "P1", dependsOn: [p0.id, p0.id] });
    expect(p1.dependsOn).toEqual([p0.id]);
    expect((await listPhases(db, owner, slug)).find((p) => p.id === p1.id)?.dependsOn).toEqual([p0.id]);
  });
});

describe("updateDomain", () => {
  it("changes name and description and logs each changed field", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const d = await createDomain(db, owner, slug, { name: "Police", description: "Cops" });
    const row = await updateDomain(db, editor, slug, d.id, { name: "Law", description: "Cops" });
    expect([row.name, row.description]).toEqual(["Law", "Cops"]);
    const logs = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.projectId, projectId), eq(changeLog.entity, "domain"), eq(changeLog.entityId, d.id)));
    expect(logs.filter((l) => l.field !== "created").map((l) => [l.field, l.oldValue, l.newValue])).toEqual([["name", "Police", "Law"]]);
  });

  it("rejects viewers, unknown and foreign domains", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreign = await createDomain(db, other.owner, "other", { name: "X" });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const d = await createDomain(db, owner, slug, { name: "Police" });
    await expect(updateDomain(db, viewer, slug, d.id, { name: "Y" })).rejects.toMatchObject({ status: 403 });
    await expect(updateDomain(db, owner, slug, foreign.id, { name: "Y" })).rejects.toMatchObject({
      status: 404,
      message: `Unknown domain ${foreign.id}.`,
    });
  });
});

describe("reorderDomains", () => {
  it("stores the new order and logs moved domains", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const a = await createDomain(db, owner, slug, { name: "A" });
    const b = await createDomain(db, owner, slug, { name: "B" });
    const c = await createDomain(db, owner, slug, { name: "C" });
    await reorderDomains(db, owner, slug, [c.id, a.id, b.id]);
    expect((await listDomains(db, owner, slug)).map((d) => d.name)).toEqual(["C", "A", "B"]);
    const logs = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.projectId, projectId), eq(changeLog.field, "position")));
    expect(logs.map((l) => [l.entityId, l.oldValue, l.newValue]).sort()).toEqual(
      [
        [c.id, "3", "1"],
        [a.id, "1", "2"],
        [b.id, "2", "3"],
      ].sort(),
    );
  });

  it("requires every domain of the project exactly once", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreign = await createDomain(db, other.owner, "other", { name: "X" });
    const a = await createDomain(db, owner, slug, { name: "A" });
    const b = await createDomain(db, owner, slug, { name: "B" });
    await expect(reorderDomains(db, owner, slug, [a.id])).rejects.toMatchObject({ status: 400 });
    await expect(reorderDomains(db, owner, slug, [a.id, a.id])).rejects.toMatchObject({ status: 400 });
    await expect(reorderDomains(db, owner, slug, [a.id, foreign.id])).rejects.toMatchObject({ status: 400 });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(reorderDomains(db, viewer, slug, [b.id, a.id])).rejects.toMatchObject({ status: 403 });
  });
});

describe("updatePhase", () => {
  it("changes name, goal and dependencies and logs them", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const p0 = await createPhase(db, owner, slug, { name: "P0" });
    const p1 = await createPhase(db, owner, slug, { name: "P1" });
    const p2 = await createPhase(db, owner, slug, { name: "P2", dependsOn: [p0.id] });
    const row = await updatePhase(db, owner, slug, p2.id, { name: "Beta", goal: "Ship", dependsOn: [p1.id, p1.id] });
    expect([row.name, row.goal, row.dependsOn]).toEqual(["Beta", "Ship", [p1.id]]);
    expect((await listPhases(db, owner, slug)).find((p) => p.id === p2.id)?.dependsOn).toEqual([p1.id]);
    const logs = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.projectId, projectId), eq(changeLog.entityId, p2.id)));
    expect(logs.filter((l) => l.field !== "created").map((l) => [l.field, l.oldValue, l.newValue])).toEqual([
      ["name", "P2", "Beta"],
      ["goal", "", "Ship"],
      ["dependsOn", "P0", "P1"],
    ]);
  });

  it("keeps dependencies when they are omitted and clears them with an empty list", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const p0 = await createPhase(db, owner, slug, { name: "P0" });
    const p1 = await createPhase(db, owner, slug, { name: "P1", dependsOn: [p0.id] });
    expect((await updatePhase(db, owner, slug, p1.id, { name: "Beta" })).dependsOn).toEqual([p0.id]);
    expect((await updatePhase(db, owner, slug, p1.id, { dependsOn: [] })).dependsOn).toEqual([]);
  });

  it("rejects foreign phases, self-dependency and cycles", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreign = await createPhase(db, other.owner, "other", { name: "Foreign" });
    const p0 = await createPhase(db, owner, slug, { name: "P0" });
    const p1 = await createPhase(db, owner, slug, { name: "P1", dependsOn: [p0.id] });
    const p2 = await createPhase(db, owner, slug, { name: "P2", dependsOn: [p1.id] });
    await expect(updatePhase(db, owner, slug, p0.id, { dependsOn: [foreign.id] })).rejects.toMatchObject({
      status: 400,
      message: `Unknown phase ${foreign.id}.`,
    });
    await expect(updatePhase(db, owner, slug, p0.id, { dependsOn: [p0.id] })).rejects.toMatchObject({
      status: 400,
      message: "A phase cannot depend on itself.",
    });
    await expect(updatePhase(db, owner, slug, p0.id, { dependsOn: [p2.id] })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("cycle"),
    });
    await expect(updatePhase(db, owner, slug, foreign.id, { name: "X" })).rejects.toMatchObject({ status: 404 });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(updatePhase(db, viewer, slug, p0.id, { name: "X" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("reorderPhases", () => {
  it("stores the new order and requires every phase exactly once", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const p0 = await createPhase(db, owner, slug, { name: "P0" });
    const p1 = await createPhase(db, owner, slug, { name: "P1" });
    const p2 = await createPhase(db, owner, slug, { name: "P2" });
    await reorderPhases(db, owner, slug, [p2.id, p0.id, p1.id]);
    expect((await listPhases(db, owner, slug)).map((p) => p.name)).toEqual(["P2", "P0", "P1"]);
    await expect(reorderPhases(db, owner, slug, [p2.id, p0.id])).rejects.toMatchObject({ status: 400 });
  });
});
