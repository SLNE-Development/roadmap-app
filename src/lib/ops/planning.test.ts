import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, notification } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { setSystemArchived } from "./archive";
import { writeSpec } from "./documents";
import { addQuestion, answerQuestion } from "./questions";
import { addPlanningRound, answerPlanningItems, completePlanning, completePlanningArea, getPlanning, planningGaps, openAreaReopens, planningGapsFor, reopenPlanning, reopenPlanningArea } from "./planning";
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

describe("planning coverage", () => {
  it("reports coverage and thin-area warnings", async () => {
    const { db, owner, slug } = await setup();
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", {
      items: [
        { area: "scope", question: "Is resale in scope?" },
        { area: "scope", question: "Is trading in scope?" },
        { area: "dependencies", question: "Which service issues cars?" },
      ],
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: itemIds.map((itemId) => ({ itemId, answer: "Yes" })) });
    const { coverage, warnings } = await getPlanning(db, owner, slug, "s");
    expect(coverage[2]).toMatchObject({ area: "scope", thin: false });
    expect(coverage[1]).toMatchObject({ area: "dependencies", thin: true });
    expect(warnings).toContain("Area dependencies is thin: Only 1 settled question; ask at least 2.");
  });
});

describe("blocking questions", () => {
  /** Answers every area of system `s` and writes its spec, leaving no gaps. */
  async function ready() {
    const t = await setup();
    const round = await addPlanningRound(t.db, t.owner, t.slug, "s", {
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: area })),
    });
    await answerPlanningItems(t.db, t.owner, t.slug, "s", { answers: round.itemIds.map((itemId) => ({ itemId, answer: "ok" })) });
    await writeSpec(t.db, t.owner, t.slug, "s", { body: "# Spec" });
    const id = (await getSystem(t.db, t.owner, t.slug, "s")).system.id;
    return { ...t, id };
  }

  it("holds the gate until the question is resolved", async () => {
    const { db, owner, slug, id } = await ready();
    expect(await planningGaps(db, id)).toEqual([]);
    const q = await addQuestion(db, owner, slug, { title: "Who pays?", system: "s", priority: "blocking" });
    expect(await planningGaps(db, id)).toEqual([`Question ${q.id} is blocking: "Who pays?".`]);
    expect((await getPlanning(db, owner, slug, "s")).gaps).toEqual([`Question ${q.id} is blocking: "Who pays?".`]);
    await expect(completePlanning(db, owner, slug, "s", { userConfirmation: "Go" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("is blocking") });
    await answerQuestion(db, owner, slug, { id: q.id, answer: "Nobody", resolved: false });
    expect(await planningGaps(db, id)).toHaveLength(1);
    await answerQuestion(db, owner, slug, { id: q.id, answer: "Nobody", resolved: true });
    expect(await planningGaps(db, id)).toEqual([]);
  });

  it("does not count questions of an archived system", async () => {
    const { db, owner, slug, id } = await ready();
    await addQuestion(db, owner, slug, { title: "Stuck", system: "s", priority: "blocking" });
    await setSystemArchived(db, owner, slug, "s", true);
    expect(await planningGaps(db, id)).toEqual([]);
  });

  it("ignores normal questions and agrees with the batched path", async () => {
    const { db, owner, slug, id } = await ready();
    await addQuestion(db, owner, slug, { title: "Fine?", system: "s" });
    expect(await planningGaps(db, id)).toEqual([]);
    await addQuestion(db, owner, slug, { title: "Stuck", system: "s", priority: "blocking" });
    expect((await planningGapsFor(db, [id])).get(id)).toEqual(await planningGaps(db, id));
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

  it("reopening planning that is not complete is a conflict", async () => {
    const { db, owner, slug } = await setup();
    await expect(reopenPlanning(db, owner, slug, "s")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("is not complete") });
    expect((await db.select().from(changeLog)).filter((c) => c.field === "reopened")).toEqual([]);
  });
});

describe("planning area reopen", () => {
  /** A system `s` with completed planning and one answered scope item. */
  async function completed() {
    const t = await setup();
    const { itemIds } = await addPlanningRound(t.db, t.owner, t.slug, "s", { items: [{ area: "scope", question: "Is resale in scope?" }] });
    await answerPlanningItems(t.db, t.owner, t.slug, "s", { answers: [{ itemId: itemIds[0], answer: "No" }] });
    const id = (await getSystem(t.db, t.owner, t.slug, "s")).system.id;
    await completePlanningFixture(t.db, id);
    return { ...t, id };
  }

  it("keeps planning complete and the column, and logs the reopen", async () => {
    const { db, owner, slug } = await completed();
    const before = (await getSystem(db, owner, slug, "s")).column.name;
    await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" });
    const view = await getPlanning(db, owner, slug, "s");
    expect(view.completedAt).not.toBeNull();
    expect(view.reopenedAreas).toMatchObject([{ area: "scope", reason: "new partner API" }]);
    expect((await getSystem(db, owner, slug, "s")).column.name).toBe(before);
    const log = (await db.select().from(changeLog)).filter((c) => c.entity === "planning" && c.field === "area-reopened");
    expect(log).toMatchObject([{ newValue: "scope", oldValue: "new partner API" }]);
  });

  it("accepts new questions only for reopened areas", async () => {
    const { db, owner, slug } = await completed();
    await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" });
    await expect(addPlanningRound(db, owner, slug, "s", { items: [{ area: "dependencies", question: "Who?" }] })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("dependencies is not reopened"),
    });
    await expect(addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "Which API?" }] })).resolves.toMatchObject({ round: 2 });
  });

  it("answers items of reopened areas only", async () => {
    const { db, owner, slug } = await completed();
    const { itemIds } = await getPlanning(db, owner, slug, "s").then((v) => ({ itemIds: v.rounds[0].items.map((i) => i.id) }));
    await expect(answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[0], answer: "x" }] })).rejects.toMatchObject({ status: 409 });
    await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" });
    await expect(answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[0], answer: "Still no" }] })).resolves.toEqual({ answered: 1 });
  });

  it("completes an area only after a new question was asked and answered", async () => {
    const { db, owner, slug } = await completed();
    await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" });
    await expect(completePlanningArea(db, owner, slug, "s", { area: "scope", userConfirmation: "ok" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("No question was asked since area scope was reopened"),
    });
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "Which API?" }] });
    await expect(completePlanningArea(db, owner, slug, "s", { area: "scope", userConfirmation: "ok" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(`Item ${itemIds[0]} is still open`),
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[0], answer: "Partner v2" }] });
    await completePlanningArea(db, owner, slug, "s", { area: "scope", userConfirmation: "ok" });
    expect((await getPlanning(db, owner, slug, "s")).reopenedAreas).toEqual([]);
    const log = (await db.select().from(changeLog)).filter((c) => c.entity === "planning" && c.field === "area-completed");
    expect(log).toMatchObject([{ newValue: "scope", oldValue: "ok" }]);
  });

  it("refuses a reopen while the system is still in planning", async () => {
    const { db, owner, slug } = await setup();
    await expect(reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" })).rejects.toMatchObject({ status: 409 });
  });

  it("returns the existing reopen when reopened twice", async () => {
    const { db, owner, slug, id } = await completed();
    const first = await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" });
    const second = await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "again" });
    expect(second.reopenedAt).toEqual(first.reopenedAt);
    expect(await openAreaReopens(db, id)).toHaveLength(1);
  });

  it("closes area reopens when the whole planning is reopened", async () => {
    const { db, owner, slug } = await completed();
    await reopenPlanningArea(db, owner, slug, "s", { area: "scope", reason: "new partner API" });
    await reopenPlanning(db, owner, slug, "s");
    expect((await getPlanning(db, owner, slug, "s")).reopenedAreas).toEqual([]);
  });

  it("is an editor action", async () => {
    const { db, owner, slug } = await completed();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(reopenPlanningArea(db, viewer, slug, "s", { area: "scope", reason: "new partner API" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("mentions in planning answers", () => {
  it("stores @Jules in an answer as a token and notifies Jules", async () => {
    const { db, owner, slug } = await setup();
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "Who decides?" }] });
    await answerPlanningItems(db, owner, slug, "s", { answers: [{ itemId: itemIds[0], answer: "@Jules decides" }] });
    const { rounds } = await getPlanning(db, owner, slug, "s");
    expect(rounds[0].items[0].answer).toBe(`[@Jules](user:${jules.userId}) decides`);
    const rows = await db.select().from(notification).where(eq(notification.userId, jules.userId));
    expect(rows.map((r) => [r.kind, r.href, r.sourceKey])).toEqual([["mention", "/p/demo/systems/s?tab=planning", `planning:${itemIds[0]}:mention:${jules.userId}`]]);
  });
});
