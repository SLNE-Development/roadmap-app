import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { createDomain, createPhase, deleteDomain, deletePhase, listDomains, listPhases } from "./structure";

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
});
