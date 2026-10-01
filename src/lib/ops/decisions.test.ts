import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { acceptAdr, createAdr, supersedeAdr, updateAdr } from "./adrs";
import { setSystemArchived } from "./archive";
import { getDecisionGraph } from "./decisions";
import { NotFoundError } from "./errors";
import { createSystem } from "./systems";
import { addTask } from "./tasks";

/** A complete ADR body with the given title. */
const body = (title: string) => ({ title, context: "Why", decision: "What", alternatives: "B", consequences: "C" });

/** ADR 1 (superseded) and ADR 2 (accepted, linked to system `search` and a task of it). */
async function setup() {
  const db = await createTestDb();
  const { owner, slug } = await createProjectFixture(db);
  await createSystem(db, owner, slug, { slug: "search", title: "Search" });
  const { id } = await addTask(db, owner, slug, "search", { title: "Index it" });
  await createAdr(db, owner, slug, body("Old"));
  await createAdr(db, owner, slug, { ...body("New"), systems: ["search"], tasks: [id] });
  await acceptAdr(db, owner, slug, 1);
  await acceptAdr(db, owner, slug, 2);
  await supersedeAdr(db, owner, slug, { number: 1, by: 2 });
  return { db, owner, slug, taskId: id };
}

const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort();

describe("getDecisionGraph", () => {
  it("links the newer ADR to the one it supersedes and to its systems", async () => {
    const { db, owner, slug } = await setup();
    const g = await getDecisionGraph(db, owner, slug, {});
    expect(g.nodes.filter((n) => n.kind === "adr").map((n) => n.number).sort()).toEqual([1, 2]);
    expect(g.nodes.find((n) => n.kind === "system")).toMatchObject({ slug: "search", title: "Search", category: "planning" });
    expect(g.edges).toHaveLength(2);
    expect(g.edges).toContainEqual({ from: expect.stringMatching(/^adr:/), to: expect.stringMatching(/^adr:/), kind: "supersedes" });
    expect(g.edges).toContainEqual({ from: expect.stringMatching(/^adr:/), to: expect.stringMatching(/^sys:/), kind: "concerns" });
    const newer = g.nodes.find((n) => n.kind === "adr" && n.number === 2)!;
    const older = g.nodes.find((n) => n.kind === "adr" && n.number === 1)!;
    expect(g.edges.find((e) => e.kind === "supersedes")).toEqual({ from: newer.id, to: older.id, kind: "supersedes" });
    expect(newer.id).toMatch(/^adr:/);
  });

  it("leaves systems out with systems: false", async () => {
    const { db, owner, slug } = await setup();
    const g = await getDecisionGraph(db, owner, slug, { systems: false });
    expect(g.nodes.every((n) => n.kind === "adr")).toBe(true);
    expect(g.edges.map((e) => e.kind)).toEqual(["supersedes"]);
  });

  it("adds task nodes with tasks: true", async () => {
    const { db, owner, slug, taskId } = await setup();
    const g = await getDecisionGraph(db, owner, slug, { tasks: true });
    expect(g.nodes).toContainEqual(expect.objectContaining({ kind: "task", id: `task:${taskId}`, taskId, title: "Index it", systemSlug: "search" }));
    expect(g.edges.filter((e) => e.kind === "task")).toHaveLength(1);
  });

  it("filters by status and keeps only the systems of the remaining ADRs", async () => {
    const { db, owner, slug } = await setup();
    await createAdr(db, owner, slug, body("Third"));
    await createSystem(db, owner, slug, { slug: "other", title: "Other" });
    await updateAdr(db, owner, slug, 3, { systems: ["other"] });
    const g = await getDecisionGraph(db, owner, slug, { status: "accepted" });
    expect(g.nodes.filter((n) => n.kind === "adr").map((n) => n.number)).toEqual([2]);
    expect(g.nodes.filter((n) => n.kind === "system").map((n) => n.slug)).toEqual(["search"]);
    expect(g.edges.map((e) => e.kind)).toEqual(["concerns"]);
  });

  it("leaves archived systems and their tasks out", async () => {
    const { db, owner, slug } = await setup();
    await setSystemArchived(db, owner, slug, "search", true);
    const g = await getDecisionGraph(db, owner, slug, { tasks: true });
    expect(g.nodes.every((n) => n.kind === "adr")).toBe(true);
    expect(ids(g)).toHaveLength(2);
  });

  it("lets a viewer read it and hides it from a non-member", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect((await getDecisionGraph(db, viewer, slug, {})).nodes.length).toBeGreaterThan(0);
    const stranger = await insertUser(db, { name: "Stranger" });
    await expect(getDecisionGraph(db, stranger, slug, {})).rejects.toBeInstanceOf(NotFoundError);
  });
});
