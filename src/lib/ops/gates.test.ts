import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { progressUpdate } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import type { Actor } from "./actor";
import { acceptAdr, createAdr } from "./adrs";
import { writePlan, writeSpec } from "./documents";
import { evaluateGates, GATE_RULES, gateMessage, registerGateRule, type GateSubject } from "./gates";
import { addQuestion } from "./questions";
import { createSystem } from "./systems";
import { addTask, updateTask } from "./tasks";
import { postUpdate } from "./updates";

const NOW = new Date("2026-10-01T12:00:00Z");

/** Creates a project with one planned system and returns it as a gate subject. */
async function setup(): Promise<{ db: Db; owner: Actor; slug: string; subject: GateSubject }> {
  const db = await createTestDb();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const row = await createSystem(db, owner, slug, { slug: "search-index", title: "Search index" });
  await completePlanningFixture(db, row.id);
  return { db, owner, slug, subject: { id: row.id, slug: row.slug, projectId } };
}

/** Evaluates one rule for one subject and returns its unmet reason, or null when met. */
async function check(db: Db, subject: GateSubject, rule: string, param: number | null = null): Promise<string | null> {
  const results = await (GATE_RULES.get(rule) as NonNullable<ReturnType<typeof GATE_RULES.get>>).check(db, [subject], param, NOW);
  return results.get(subject.id) ?? null;
}

describe("all-tasks-done", () => {
  it("is met when every task is done, also with no tasks", async () => {
    const { db, owner, slug, subject } = await setup();
    expect(await check(db, subject, "all-tasks-done")).toBeNull();
    const { id } = await addTask(db, owner, slug, subject.slug, { title: "A" });
    await updateTask(db, owner, id, { state: "done" });
    expect(await check(db, subject, "all-tasks-done")).toBeNull();
  });

  it("lists open task ids, at most five then an ellipsis", async () => {
    const { db, owner, slug, subject } = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push((await addTask(db, owner, slug, subject.slug, { title: `T${i}` })).id);
    await updateTask(db, owner, ids[5], { state: "done" });
    expect(await check(db, subject, "all-tasks-done")).toBe(`5 open tasks (${ids.slice(0, 5).map((i) => `#${i}`).join(", ")})`);
    await updateTask(db, owner, ids[5], { state: "todo" });
    expect(await check(db, subject, "all-tasks-done")).toBe(`6 open tasks (${ids.slice(0, 5).map((i) => `#${i}`).join(", ")}, …)`);
    for (const id of ids.slice(1)) await updateTask(db, owner, id, { state: "done" });
    expect(await check(db, subject, "all-tasks-done")).toBe(`1 open task (#${ids[0]})`);
  });
});

describe("no-open-questions", () => {
  it("is met without unresolved questions on the system", async () => {
    const { db, owner, slug, subject } = await setup();
    await addQuestion(db, owner, slug, { title: "Project-wide?" });
    expect(await check(db, subject, "no-open-questions")).toBeNull();
  });

  it("counts open questions with singular and plural wording", async () => {
    const { db, owner, slug, subject } = await setup();
    await addQuestion(db, owner, slug, { title: "Q1", system: subject.slug });
    expect(await check(db, subject, "no-open-questions")).toBe("1 open question");
    await addQuestion(db, owner, slug, { title: "Q2", system: subject.slug });
    await addQuestion(db, owner, slug, { title: "Q3", system: subject.slug });
    expect(await check(db, subject, "no-open-questions")).toBe("3 open questions");
  });
});

describe("spec-exists", () => {
  it("is met once a spec is written", async () => {
    const { db, owner, slug, subject } = await setup();
    expect(await check(db, subject, "spec-exists")).toBe("no spec");
    await writeSpec(db, owner, slug, subject.slug, { body: "# Spec" });
    expect(await check(db, subject, "spec-exists")).toBeNull();
  });
});

describe("plan-covers-tasks", () => {
  it("is met when a plan exists and every task is a plan step", async () => {
    const { db, owner, slug, subject } = await setup();
    await writePlan(db, owner, slug, subject.slug, { body: "# Plan", steps: [{ step: 1, title: "One" }] });
    expect(await check(db, subject, "plan-covers-tasks")).toBeNull();
  });

  it("names a missing plan and tasks outside the plan", async () => {
    const { db, owner, slug, subject } = await setup();
    expect(await check(db, subject, "plan-covers-tasks")).toBe("no plan");
    const a = await addTask(db, owner, slug, subject.slug, { title: "Extra A" });
    const b = await addTask(db, owner, slug, subject.slug, { title: "Extra B" });
    await writePlan(db, owner, slug, subject.slug, { body: "# Plan", steps: [{ step: 1, title: "One" }] });
    expect(await check(db, subject, "plan-covers-tasks")).toBe(`tasks #${a.id}, #${b.id} are not in the plan`);
  });
});

describe("update-within-days", () => {
  it("has a 1 to 60 day parameter defaulting to 3", () => {
    const rule = GATE_RULES.get("update-within-days");
    expect(rule?.param).toEqual({ min: 1, max: 60, default: 3, unit: "days" });
    expect(rule?.label(3)).toBe("Progress update in the last 3 days");
    expect(GATE_RULES.get("all-tasks-done")?.label(null)).toBe("All tasks done");
  });

  it("is unmet without any update", async () => {
    const { db, subject } = await setup();
    expect(await check(db, subject, "update-within-days", 3)).toBe("no progress update in the last 3 days");
  });

  it("measures against the passed now", async () => {
    const { db, owner, slug, subject } = await setup();
    await postUpdate(db, owner, slug, subject.slug, { summary: "Did things" });
    const [latest] = await db.select({ at: progressUpdate.createdAt }).from(progressUpdate).where(eq(progressUpdate.systemId, subject.id));
    const now = new Date(latest.at.getTime() + 2 * 24 * 60 * 60 * 1000);
    const rule = GATE_RULES.get("update-within-days") as NonNullable<ReturnType<typeof GATE_RULES.get>>;
    expect((await rule.check(db, [subject], 3, now)).get(subject.id)).toBeNull();
    expect((await rule.check(db, [subject], 1, now)).get(subject.id)).toBe("no progress update in the last 1 day");
  });
});

describe("adr-linked", () => {
  const body = { title: "Use Postgres", context: "Why", decision: "What", alternatives: "Other", consequences: "Costs" };

  it("is met with an accepted ADR linked to the system", async () => {
    const { db, owner, slug, subject } = await setup();
    const { number } = await createAdr(db, owner, slug, { ...body, systems: [subject.slug] });
    await acceptAdr(db, owner, slug, number);
    expect(await check(db, subject, "adr-linked")).toBeNull();
  });

  it("is unmet with only a proposed ADR", async () => {
    const { db, owner, slug, subject } = await setup();
    await createAdr(db, owner, slug, { ...body, systems: [subject.slug] });
    expect(await check(db, subject, "adr-linked")).toBe("no accepted ADR linked");
  });
});

describe("evaluateGates", () => {
  it("evaluates several systems of mixed state at once", async () => {
    const { db, owner, slug, subject } = await setup();
    const make = async (s: string) => {
      const row = await createSystem(db, owner, slug, { slug: s, title: s });
      await completePlanningFixture(db, row.id);
      return { id: row.id, slug: row.slug, projectId: subject.projectId };
    };
    const second = await make("second");
    const third = await make("third");
    const open = await addTask(db, owner, slug, "second", { title: "Open" });
    await addQuestion(db, owner, slug, { title: "Q", system: "third" });
    const rules = [{ rule: "all-tasks-done", param: null }, { rule: "no-open-questions", param: null }];
    const results = await evaluateGates(db, [subject, second, third], "Done", rules, NOW);
    expect(results.get(subject.id)).toEqual({ column: "Done", met: 2, total: 2, unmet: [] });
    expect(results.get(second.id)).toEqual({ column: "Done", met: 1, total: 2, unmet: [`1 open task (#${open.id})`] });
    expect(results.get(third.id)).toEqual({ column: "Done", met: 1, total: 2, unmet: ["1 open question"] });
  });

  it("uses each rule's default param when the row has none", async () => {
    const { db, subject } = await setup();
    const results = await evaluateGates(db, [subject], "Done", [{ rule: "update-within-days", param: null }], NOW);
    expect(results.get(subject.id)?.unmet).toEqual(["no progress update in the last 3 days"]);
  });
});

describe("registerGateRule", () => {
  it("throws on a duplicate id", () => {
    expect(() => registerGateRule({ id: "spec-exists", label: () => "Again", check: async () => new Map() })).toThrow(Error);
  });
});

describe("gateMessage", () => {
  it("names the system, column and every unmet rule", () => {
    expect(gateMessage("search-index", { column: "Done", met: 0, total: 2, unmet: ["2 open tasks (#1, #2)", "1 open question"] })).toBe(
      "Can't move search-index to Done. Missing: 2 open tasks (#1, #2); 1 open question. Finish them, or ask a project owner to move it with overrideReason.",
    );
  });
});
