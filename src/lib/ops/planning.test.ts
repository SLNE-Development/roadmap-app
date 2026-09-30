import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { writeSpec } from "./documents";
import { addPlanningRound, answerPlanningItems, completePlanning, getPlanning, planningGaps, planningGapsFor, reopenPlanning } from "./planning";
import { createSystem, getSystem, moveSystem } from "./systems";
import { addTask, updateTask } from "./tasks";

/** Creates project `demo` with system `s` and returns the owner. */
async function setup() {
  const db = await createTestDb();
  const { owner, slug } = await createProjectFixture(db);
  await createSystem(db, owner, slug, { slug: "s", title: "S" });
  return { db, owner, slug };
}

describe("planning gaps", () => {
  it("lists every missing area, open item and the missing spec", async () => {
    const { db, owner, slug } = await setup();
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", {
      items: [
        { area: "failure-modes", question: "What if two players buy the last car?", isRisk: true },
        { area: "scope", question: "Is resale in scope?" },
      ],
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[1], answer: "No" }] });
    const { gaps } = await getPlanning(db, owner, slug, "s");
    expect(gaps).toEqual([
      "Area failure-modes has no answered item.",
      "Area dependencies has no answered item.",
      "Area ops-testing has no answered item.",
      `Item ${itemIds[0]} is still open: "What if two players buy the last car?".`,
      "No spec has been written; call write_spec.",
    ]);
  });
});

describe("planningGapsFor", () => {
  it("matches planningGaps for several systems", async () => {
    const { db, owner, slug } = await setup();
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const c = await createSystem(db, owner, slug, { slug: "c", title: "C" });
    const a = (await getSystem(db, owner, slug, "s")).system;
    const full = await addPlanningRound(db, owner, slug, "s", {
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: area })),
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: full.itemIds.map((itemId) => ({ itemId, answer: "ok" })) });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    await addPlanningRound(db, owner, slug, "b", { items: [{ area: "scope", question: "Only one?" }] });
    const ids = [a.id, b.id, c.id];
    const expected = new Map(await Promise.all(ids.map(async (id) => [id, await planningGaps(db, id)] as const)));
    expect(await planningGapsFor(db, ids)).toEqual(expected);
    expect(expected.get(a.id)).toEqual([]);
  });

  it("returns an empty map for no systems", async () => {
    const { db } = await setup();
    expect((await planningGapsFor(db, [])).size).toBe(0);
  });
});

describe("completePlanning", () => {
  it("refuses while gaps remain and names them", async () => {
    const { db, owner, slug } = await setup();
    await expect(completePlanning(db, owner, slug, "s", { userConfirmation: "Looks good" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/^Planning of system s is not complete: Area failure-modes has no answered item\./),
    });
  });

  it("completes when all areas are answered, no item is open and a spec exists, then opens the gate", async () => {
    const { db, owner, slug } = await setup();
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", {
      items: [
        { area: "failure-modes", question: "Race on purchase?", isRisk: true },
        { area: "dependencies", question: "Needs economy?" },
        { area: "scope", question: "Resale?" },
        { area: "ops-testing", question: "Load test?" },
      ],
    });
    await answerPlanningItems(db, owner, slug, "s", {
      answers: [
        { itemId: itemIds[0], answer: "Acceptable for MVP, single server", status: "accepted-risk" },
        { itemId: itemIds[1], answer: "Yes, economy v1" },
        { itemId: itemIds[2], answer: "Out of scope" },
        { itemId: itemIds[3], answer: "k6 with 200 users" },
      ],
    });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    await completePlanning(db, owner, slug, "s", { userConfirmation: "Yes, that is exactly it." });
    const planning = await getPlanning(db, owner, slug, "s");
    expect(planning.gaps).toEqual([]);
    expect(planning.confirmation).toBe("Yes, that is exactly it.");
    expect(planning.rounds[0].items.map((i) => i.status)).toEqual(["accepted-risk", "answered", "answered", "answered"]);
    await moveSystem(db, owner, slug, "s", { column: "Todo" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await updateTask(db, owner, id, { state: "doing" });
  });

  it("only accepts risks for items flagged as risks", async () => {
    const { db, owner, slug } = await setup();
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "Resale?" }] });
    await expect(
      answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[0], answer: "meh", status: "accepted-risk" }] }),
    ).rejects.toMatchObject({ status: 400, message: `Item ${itemIds[0]} is not a flagged risk; answer it instead of accepting it.` });
  });

  it("rejects items of other systems", async () => {
    const { db, owner, slug } = await setup();
    await createSystem(db, owner, slug, { slug: "t", title: "T" });
    const { itemIds } = await addPlanningRound(db, owner, slug, "t", { items: [{ area: "scope", question: "?" }] });
    await expect(answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[0], answer: "x" }] })).rejects.toMatchObject({
      status: 404,
      message: `Unknown planning item ${itemIds[0]}.`,
    });
  });
});

describe("the gate message", () => {
  it("lists what is missing when a move is refused", async () => {
    const { db, owner, slug } = await setup();
    await expect(moveSystem(db, owner, slug, "s", { column: "Todo" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Missing: Area failure-modes has no answered item."),
    });
  });
});

describe("reopenPlanning", () => {
  it("clears completion, returns the system to planning and allows new rounds again", async () => {
    const { db, owner, slug } = await setup();
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", {
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: area })),
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: itemIds.map((itemId) => ({ itemId, answer: "ok" })) });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    await completePlanning(db, owner, slug, "s", { userConfirmation: "yes" });
    await expect(addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "more?" }] })).rejects.toMatchObject({
      status: 409,
      message: "Planning of system s is complete; call reopen_planning to change it.",
    });
    await moveSystem(db, owner, slug, "s", { column: "Review" });
    await reopenPlanning(db, owner, slug, "s");
    const detail = await getSystem(db, owner, slug, "s");
    expect([detail.column.category, detail.system.planningCompletedAt]).toEqual(["planning", null]);
    expect((await addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "more?" }] })).round).toBe(2);
  });

  it("logs the column change and the reopening", async () => {
    const { db, owner, slug } = await setup();
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", {
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: area })),
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: itemIds.map((itemId) => ({ itemId, answer: "ok" })) });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    await completePlanning(db, owner, slug, "s", { userConfirmation: "yes" });
    await moveSystem(db, owner, slug, "s", { column: "Review" });
    await reopenPlanning(db, owner, slug, "s");
    const rows = (await db.select().from(changeLog)).filter((c) => (c.field === "column" || c.field === "reopened") && c.entityId);
    const entries = rows.map((c) => [c.field, c.oldValue, c.newValue]);
    expect(entries.at(-2)).toEqual(["column", expect.stringMatching(/ \/ Review$/), expect.stringMatching(/ \/ Planning$/)]);
    expect(entries.at(-1)?.[0]).toBe("reopened");
  });
});
