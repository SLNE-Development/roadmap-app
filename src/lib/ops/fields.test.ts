import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, systemFieldValue } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import {
  createCustomField,
  deleteCustomField,
  fieldInput,
  listCustomFields,
  reorderCustomFields,
  setSystemFields,
  updateCustomField,
} from "./fields";
import { getSystemOverview } from "./overview";
import { createSystem, listSystems } from "./systems";

describe("custom fields", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createCustomField(db, owner, slug, { key: "risk", name: "Risk", type: "select", options: ["low", "high"] });
    await createCustomField(db, owner, slug, { key: "effort", name: "Effort", type: "number" });
    await createCustomField(db, owner, slug, { key: "due", name: "Due", type: "date" });
    const sys = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const fields = async () => (await listSystems(db, owner, slug))[0].fields;
    return { db, owner, slug, sys, fields };
  }

  it("stores values and lists them by key, in one overview with definitions", async () => {
    const { db, owner, slug, fields } = await setup();
    await setSystemFields(db, owner, slug, "a", { values: { risk: "high", effort: 5, due: "2026-11-02" } });
    expect(await fields()).toEqual({ risk: "high", effort: "5", due: "2026-11-02" });
    const overview = await getSystemOverview(db, owner, slug, "a");
    expect(overview.fields.map((f) => [f.key, f.value])).toEqual([
      ["risk", "high"],
      ["effort", "5"],
      ["due", "2026-11-02"],
    ]);
    expect(overview.fields[0]).toMatchObject({ name: "Risk", type: "select", options: ["low", "high"] });
  });

  it("rejects invalid values and unknown keys", async () => {
    const { db, owner, slug } = await setup();
    const set = (values: Record<string, string | number | null>) => setSystemFields(db, owner, slug, "a", { values });
    await expect(set({ risk: "medium" })).rejects.toMatchObject({ status: 400 });
    await expect(set({ due: "2026-02-30" })).rejects.toMatchObject({ status: 400 });
    await expect(set({ due: "2026-13-45" })).rejects.toMatchObject({ status: 400 });
    await expect(set({ due: "2026-00-10" })).rejects.toMatchObject({ status: 400 });
    await expect(set({ effort: Number.POSITIVE_INFINITY })).rejects.toMatchObject({ status: 400 });
    await expect(set({ foo: "x" })).rejects.toMatchObject({ status: 400, message: "Unknown field foo." });
  });

  it("clears a value with null and logs the change", async () => {
    const { db, owner, slug, sys, fields } = await setup();
    await setSystemFields(db, owner, slug, "a", { values: { risk: "high" } });
    await setSystemFields(db, owner, slug, "a", { values: { risk: null } });
    expect(await fields()).toEqual({});
    const log = await db.select().from(changeLog).where(eq(changeLog.field, "fields.risk"));
    expect(log.map((l) => [l.entity, l.entityId, l.oldValue, l.newValue])).toEqual([
      ["system", sys.id, null, "high"],
      ["system", sys.id, "high", null],
    ]);
  });

  it("refuses to remove an option that systems use", async () => {
    const { db, owner, slug, fields } = await setup();
    await setSystemFields(db, owner, slug, "a", { values: { risk: "high" } });
    await expect(updateCustomField(db, owner, slug, "risk", { options: ["low"] })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("1 system"),
    });
    await updateCustomField(db, owner, slug, "risk", { options: ["low", "high", "extreme"] });
    expect((await listCustomFields(db, owner, slug))[0].options).toEqual(["low", "high", "extreme"]);
    expect(await fields()).toEqual({ risk: "high" });
  });

  it("limits definitions to owners and values to editors", async () => {
    const { db, owner, slug } = await setup();
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(createCustomField(db, editor, slug, { key: "x", name: "X", type: "text" })).rejects.toMatchObject({ status: 403 });
    await setSystemFields(db, editor, slug, "a", { values: { effort: 2 } });
    await expect(setSystemFields(db, viewer, slug, "a", { values: { effort: 3 } })).rejects.toMatchObject({ status: 403 });
  });

  it("deletes a field with its values", async () => {
    const { db, owner, slug, fields } = await setup();
    await setSystemFields(db, owner, slug, "a", { values: { risk: "high", effort: 1 } });
    await deleteCustomField(db, owner, slug, "risk");
    expect(await fields()).toEqual({ effort: "1" });
    expect(await db.select().from(systemFieldValue)).toHaveLength(1);
  });

  it("reorders fields", async () => {
    const { db, owner, slug } = await setup();
    await reorderCustomFields(db, owner, slug, ["due", "risk", "effort"]);
    expect((await listCustomFields(db, owner, slug)).map((f) => f.key)).toEqual(["due", "risk", "effort"]);
    await expect(reorderCustomFields(db, owner, slug, ["due", "risk"])).rejects.toMatchObject({ status: 400 });
  });

  it("validates definitions", () => {
    expect(fieldInput.safeParse({ key: "t", name: "T", type: "text", options: ["x"] }).success).toBe(false);
    expect(fieldInput.safeParse({ key: "s", name: "S", type: "select" }).success).toBe(false);
    expect(fieldInput.safeParse({ key: "s", name: "S", type: "select", options: ["a", "A"] }).success).toBe(false);
    expect(fieldInput.safeParse({ key: "s", name: "S", type: "select", options: ["a", "b"] }).success).toBe(true);
  });

  it("rejects a duplicate key", async () => {
    const { db, owner, slug } = await setup();
    await expect(createCustomField(db, owner, slug, { key: "risk", name: "R", type: "text" })).rejects.toMatchObject({ status: 409 });
  });
});
