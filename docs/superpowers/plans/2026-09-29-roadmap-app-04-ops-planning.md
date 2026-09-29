# Part 4: Documents, planning and ADRs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** Versioned specs and plans (plan steps synced to tasks), the planning interview with the server-enforced gate, ADRs with numbering, immutability and superseding, and one overview read that combines everything for a system.

**Spec:** sections 5.3 (`systemDocument`, `adr`, `question`), 5.4, 8 (`write_plan`).

**Consumes from Part 3:** `projectAccess`, `slugSchema`, `systemAccess`, `findSystem`, `loadBoards`, `SystemRow`, `planningGateMessage`, `moveSystem`, `getSystem`, `SystemDetail`, `listQuestions`, `QuestionItem`, `listUpdates`, `UpdateItem`, fixtures `createProjectFixture`, `addMemberFixture`.

---

### Task 4.1: System documents (spec and plan)

**Files:**
- Create: `src/lib/ops/documents.ts`
- Test: `src/lib/ops/documents.test.ts`

**Interfaces:**
- Produces:
  - `writeSpecInput` (zod `{ body }`), `writePlanInput` (zod `{ body, steps: { step, title }[] }` with unique steps)
  - `interface DocumentView { kind: DocumentKind; version: number; body: string; author: string; createdAt: Date; versions: number[] }`
  - `getDocument(db: Executor, actor: Actor, projectSlug: string, systemSlug: string, kind: DocumentKind, version?: number): Promise<DocumentView | null>` (viewer; latest when `version` is omitted; `NotFoundError` for an unknown version)
  - `latestDocument(db: Executor, systemId: string, kind: DocumentKind): Promise<DocumentView | null>`
  - `writeSpec(db: Db, actor: Actor, projectSlug: string, systemSlug: string, raw): Promise<{ version: number }>` (editor)
  - `interface PlanSync { version: number; createdTasks: number[]; renamedTasks: number[]; missingSteps: number[] }`
  - `writePlan(db: Db, actor: Actor, projectSlug: string, systemSlug: string, raw): Promise<PlanSync>` (editor)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/documents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { withAgent } from "./actor";
import { getDocument, writePlan, writeSpec } from "./documents";
import { createSystem, getSystem } from "./systems";

describe("specs", () => {
  it("appends versions and returns the latest or a given one", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    expect(await getDocument(db, owner, slug, "s", "spec")).toBeNull();
    await writeSpec(db, owner, slug, "s", { body: "# v1" });
    await writeSpec(db, withAgent(owner, "Claude Code"), slug, "s", { body: "# v2" });
    const latest = await getDocument(db, owner, slug, "s", "spec");
    expect(latest).toMatchObject({ version: 2, body: "# v2", author: "Claude Code (for Owner)", versions: [2, 1] });
    expect((await getDocument(db, owner, slug, "s", "spec", 1))?.body).toBe("# v1");
    await expect(getDocument(db, owner, slug, "s", "spec", 9)).rejects.toMatchObject({ status: 404, message: "System s has no spec version 9." });
  });

  it("gives parallel writers distinct consecutive versions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const results = await Promise.all([1, 2, 3].map((n) => writeSpec(db, owner, slug, "s", { body: `# ${n}` })));
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3]);
  });

  it("needs the editor role", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(writeSpec(db, viewer, slug, "s", { body: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("plans", () => {
  it("creates a task per new step, renames changed steps and reports dropped ones", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S", priority: "MVP" });
    const first = await writePlan(db, owner, slug, "s", {
      body: "## Plan",
      steps: [
        { step: 1, title: "Schema" },
        { step: 2, title: "API" },
      ],
    });
    expect(first.version).toBe(1);
    expect(first.createdTasks).toHaveLength(2);
    const second = await writePlan(db, owner, slug, "s", {
      body: "## Plan v2",
      steps: [
        { step: 1, title: "Schema and migrations" },
        { step: 3, title: "UI" },
      ],
    });
    expect(second).toMatchObject({ version: 2, renamedTasks: [first.createdTasks[0]], missingSteps: [2] });
    const { tasks } = await getSystem(db, owner, slug, "s");
    expect(tasks.map((t) => [t.planStep, t.title, t.priority])).toEqual([
      [1, "Schema and migrations", "MVP"],
      [2, "API", "MVP"],
      [3, "UI", "MVP"],
    ]);
  });

  it("rejects duplicate step numbers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(
      writePlan(db, owner, slug, "s", {
        body: "x",
        steps: [
          { step: 1, title: "A" },
          { step: 1, title: "B" },
        ],
      }),
    ).rejects.toThrow(/step numbers must be unique/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/documents.test.ts`
Expected: FAIL, `./documents` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/documents.ts`:

```ts
import { and, desc, eq, isNotNull, max } from "drizzle-orm";
import { z } from "zod";
import { systemDocument, task, user, type DocumentKind } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, systemAccess, type SystemRow } from "./lookup";

/** Markdown body of a spec or plan. */
const bodySchema = z.string().trim().min(1).max(200_000);

/** Input of {@link writeSpec}. */
export const writeSpecInput = z.object({ body: bodySchema });

/** Input of {@link writePlan}: the markdown plan and its numbered steps. */
export const writePlanInput = z.object({
  body: bodySchema,
  steps: z
    .array(z.object({ step: z.number().int().min(1).max(500), title: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(200)
    .refine((steps) => new Set(steps.map((s) => s.step)).size === steps.length, "step numbers must be unique"),
});

/** A version of a system document with the list of all its versions, newest first. */
export interface DocumentView {
  kind: DocumentKind;
  version: number;
  body: string;
  author: string;
  createdAt: Date;
  versions: number[];
}

/** What {@link writePlan} changed in the task list. */
export interface PlanSync {
  version: number;
  createdTasks: number[];
  renamedTasks: number[];
  missingSteps: number[];
}

/** Loads the given version (or the latest) of a system document, or `null` when there is none. */
async function loadDocument(db: Executor, systemId: string, kind: DocumentKind, version?: number): Promise<DocumentView | null> {
  const versions = (
    await db
      .select({ version: systemDocument.version })
      .from(systemDocument)
      .where(and(eq(systemDocument.systemId, systemId), eq(systemDocument.kind, kind)))
      .orderBy(desc(systemDocument.version))
  ).map((v) => v.version);
  const wanted = version ?? versions[0];
  if (wanted === undefined) return null;
  const [row] = await db
    .select({ body: systemDocument.body, createdAt: systemDocument.createdAt, agent: systemDocument.agent, authorName: user.name })
    .from(systemDocument)
    .leftJoin(user, eq(user.id, systemDocument.authorUserId))
    .where(and(eq(systemDocument.systemId, systemId), eq(systemDocument.kind, kind), eq(systemDocument.version, wanted)))
    .limit(1);
  if (!row) return null;
  return { kind, version: wanted, body: row.body, author: authorLabel(row.authorName, row.agent), createdAt: row.createdAt, versions };
}

/** Returns the latest version of a system document, or `null`. */
export function latestDocument(db: Executor, systemId: string, kind: DocumentKind): Promise<DocumentView | null> {
  return loadDocument(db, systemId, kind);
}

/**
 * Returns a version of a system's spec or plan (the latest when `version` is omitted), or `null` when none exists.
 *
 * @throws NotFoundError for an unknown version
 */
export async function getDocument(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  kind: DocumentKind,
  version?: number,
): Promise<DocumentView | null> {
  const { system } = await systemAccess(db, actor, projectSlug, systemSlug, "viewer");
  const found = await loadDocument(db, system.id, kind, version);
  if (!found && version !== undefined) throw new NotFoundError(`System ${systemSlug} has no ${kind} version ${version}.`);
  return found;
}

/** Appends the next version of a document; the caller holds the lock on the system row. */
async function appendVersion(tx: Tx, actor: Actor, parent: SystemRow, kind: DocumentKind, body: string): Promise<number> {
  const [{ last }] = await tx
    .select({ last: max(systemDocument.version) })
    .from(systemDocument)
    .where(and(eq(systemDocument.systemId, parent.id), eq(systemDocument.kind, kind)));
  const version = (last ?? 0) + 1;
  await tx.insert(systemDocument).values({
    id: newId(),
    systemId: parent.id,
    kind,
    version,
    body,
    authorUserId: actor.userId,
    agent: actor.agent ?? null,
  });
  await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "document", entityId: parent.id, field: kind, newValue: `v${version}` });
  return version;
}

/** Writes a new version of a system's spec. Editor or higher. */
export async function writeSpec(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof writeSpecInput>,
): Promise<{ version: number }> {
  const input = writeSpecInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const parent = await findSystem(tx, project.id, systemSlug, true);
    return { version: await appendVersion(tx, actor, parent, "spec", input.body) };
  });
}

/**
 * Writes a new version of a system's plan and syncs its steps into tasks: a step
 * without a task gets one, a step whose title changed renames its task, and tasks
 * of steps no longer in the plan are kept and reported. Editor or higher.
 */
export async function writePlan(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof writePlanInput>,
): Promise<PlanSync> {
  const input = writePlanInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const parent = await findSystem(tx, project.id, systemSlug, true);
    const version = await appendVersion(tx, actor, parent, "plan", input.body);
    const existing = await tx
      .select({ id: task.id, title: task.title, planStep: task.planStep })
      .from(task)
      .where(and(eq(task.systemId, parent.id), isNotNull(task.planStep)));
    const byStep = new Map(existing.map((t) => [t.planStep as number, t]));
    const [{ last }] = await tx.select({ last: max(task.sortOrder) }).from(task).where(eq(task.systemId, parent.id));
    let order = (last ?? -1) + 1;
    const createdTasks: number[] = [];
    const renamedTasks: number[] = [];
    for (const step of [...input.steps].sort((a, b) => a.step - b.step)) {
      const current = byStep.get(step.step);
      if (!current) {
        const [row] = await tx
          .insert(task)
          .values({ systemId: parent.id, title: step.title, priority: parent.priority, planStep: step.step, sortOrder: order++ })
          .returning({ id: task.id });
        createdTasks.push(row.id);
        await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "task", entityId: row.id, field: "created", newValue: step.title });
      } else if (current.title !== step.title) {
        await tx.update(task).set({ title: step.title }).where(eq(task.id, current.id));
        renamedTasks.push(current.id);
        await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "task", entityId: current.id, field: "title", oldValue: current.title, newValue: step.title });
      }
    }
    const listed = new Set(input.steps.map((s) => s.step));
    const missingSteps = [...byStep.keys()].filter((s) => !listed.has(s)).sort((a, b) => a - b);
    return { version, createdTasks, renamedTasks, missingSteps };
  });
}
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/lib/ops/documents.test.ts
git add -A
git commit -m "feat: Add versioned specs and plans with plan-to-task sync"
```

Expected: all document tests pass.

---

### Task 4.2: Planning rounds and the planning gate

**Files:**
- Create: `src/lib/ops/planning.ts`
- Modify: `src/lib/ops/systems.ts` (gate message lists the gaps)
- Test: `src/lib/ops/planning.test.ts`

**Interfaces:**
- Produces:
  - `planningItemInput` (zod `{ area, question, isRisk }`), `addRoundInput` (zod `{ items[1..20] }`), `answerItemsInput` (zod `{ answers: { itemId, answer, status }[1..50] }`), `completePlanningInput` (zod `{ userConfirmation }`)
  - `interface PlanningItemView { id: string; area: PlanningArea; question: string; answer: string | null; isRisk: boolean; status: PlanningItemStatus }`
  - `interface PlanningRoundView { number: number; createdAt: Date; author: string; items: PlanningItemView[] }`
  - `interface PlanningView { completedAt: Date | null; confirmation: string | null; rounds: PlanningRoundView[]; gaps: string[] }`
  - `planningGaps(db: Executor, systemId: string): Promise<string[]>`
  - `getPlanning(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<PlanningView>` (viewer)
  - `addPlanningRound(db: Db, actor, projectSlug, systemSlug, raw): Promise<{ round: number; itemIds: string[] }>` (editor)
  - `answerPlanningItems(db: Db, actor, projectSlug, systemSlug, raw): Promise<{ answered: number }>` (editor)
  - `completePlanning(db: Db, actor, projectSlug, systemSlug, raw): Promise<{ completedAt: Date }>` (editor)
  - `reopenPlanning(db: Db, actor, projectSlug, systemSlug): Promise<void>` (editor)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/planning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { writeSpec } from "./documents";
import { addPlanningRound, answerPlanningItems, completePlanning, getPlanning, reopenPlanning } from "./planning";
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/planning.test.ts`
Expected: FAIL, `./planning` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/planning.ts`:

```ts
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import {
  PLANNING_AREAS,
  planningItem,
  planningRound,
  system,
  systemDocument,
  user,
  type PlanningArea,
  type PlanningItemStatus,
} from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, loadBoards, systemAccess, type SystemRow } from "./lookup";

/** One question of a planning round. */
export const planningItemInput = z.object({
  area: z.enum(PLANNING_AREAS),
  question: z.string().trim().min(1).max(2000),
  isRisk: z.boolean().default(false),
});

/** Input of {@link addPlanningRound}. */
export const addRoundInput = z.object({ items: z.array(planningItemInput).min(1).max(20) });

/** Input of {@link answerPlanningItems}; `accepted-risk` is allowed only for flagged risks. */
export const answerItemsInput = z.object({
  answers: z
    .array(
      z.object({
        itemId: z.string().min(1),
        answer: z.string().trim().min(1).max(5000),
        status: z.enum(["answered", "accepted-risk"]).default("answered"),
      }),
    )
    .min(1)
    .max(50),
});

/** Input of {@link completePlanning}: the user's own words confirming the spec. */
export const completePlanningInput = z.object({ userConfirmation: z.string().trim().min(1).max(2000) });

/** A planning question as shown. */
export interface PlanningItemView {
  id: string;
  area: PlanningArea;
  question: string;
  answer: string | null;
  isRisk: boolean;
  status: PlanningItemStatus;
}

/** A planning round with its questions. */
export interface PlanningRoundView {
  number: number;
  createdAt: Date;
  author: string;
  items: PlanningItemView[];
}

/** The whole planning interview of a system and what still blocks its completion. */
export interface PlanningView {
  completedAt: Date | null;
  confirmation: string | null;
  rounds: PlanningRoundView[];
  gaps: string[];
}

/** Returns a question shortened to 80 characters for messages. */
function short(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Loads every round of a system with its items, in order. */
async function loadRounds(db: Executor, systemId: string): Promise<PlanningRoundView[]> {
  const rounds = await db
    .select({ id: planningRound.id, number: planningRound.number, createdAt: planningRound.createdAt, agent: planningRound.agent, authorName: user.name })
    .from(planningRound)
    .leftJoin(user, eq(user.id, planningRound.authorUserId))
    .where(eq(planningRound.systemId, systemId))
    .orderBy(asc(planningRound.number));
  if (rounds.length === 0) return [];
  const items = await db
    .select()
    .from(planningItem)
    .where(inArray(planningItem.roundId, rounds.map((r) => r.id)))
    .orderBy(asc(planningItem.sortOrder));
  return rounds.map((r) => ({
    number: r.number,
    createdAt: r.createdAt,
    author: authorLabel(r.authorName, r.agent),
    items: items
      .filter((i) => i.roundId === r.id)
      .map((i) => ({ id: i.id, area: i.area, question: i.question, answer: i.answer, isRisk: i.isRisk, status: i.status })),
  }));
}

/**
 * Returns what still prevents completing a system's planning, in this order:
 * areas without an answered or accepted item, open items, and a missing spec.
 */
export async function planningGaps(db: Executor, systemId: string): Promise<string[]> {
  const items = (await loadRounds(db, systemId)).flatMap((r) => r.items);
  const gaps: string[] = [];
  for (const area of PLANNING_AREAS) {
    if (!items.some((i) => i.area === area && i.status !== "open")) gaps.push(`Area ${area} has no answered item.`);
  }
  for (const item of items.filter((i) => i.status === "open")) gaps.push(`Item ${item.id} is still open: "${short(item.question)}".`);
  const spec = await db
    .select({ id: systemDocument.id })
    .from(systemDocument)
    .where(and(eq(systemDocument.systemId, systemId), eq(systemDocument.kind, "spec")))
    .limit(1);
  if (spec.length === 0) gaps.push("No spec has been written; call write_spec.");
  return gaps;
}

/** Throws when the system's planning is already complete. */
function assertOpen(parent: SystemRow): void {
  if (parent.planningCompletedAt) throw new ConflictError(`Planning of system ${parent.slug} is complete; call reopen_planning to change it.`);
}

/** Locks and returns a system for a planning write, checking the editor role. */
async function lockForPlanning(tx: Tx, actor: Actor, projectSlug: string, systemSlug: string): Promise<SystemRow> {
  const { project } = await projectAccess(tx, actor, projectSlug, "editor");
  return findSystem(tx, project.id, systemSlug, true);
}

/** Returns a system's planning interview, completion state and remaining gaps. */
export async function getPlanning(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<PlanningView> {
  const { system: parent } = await systemAccess(db, actor, projectSlug, systemSlug, "viewer");
  return {
    completedAt: parent.planningCompletedAt,
    confirmation: parent.planningConfirmation,
    rounds: await loadRounds(db, parent.id),
    gaps: parent.planningCompletedAt ? [] : await planningGaps(db, parent.id),
  };
}

/**
 * Records the next round of planning questions before they are asked. Editor or higher.
 *
 * @throws ConflictError if planning is complete
 */
export async function addPlanningRound(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof addRoundInput>,
): Promise<{ round: number; itemIds: string[] }> {
  const input = addRoundInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    assertOpen(parent);
    const [{ last }] = await tx.select({ last: max(planningRound.number) }).from(planningRound).where(eq(planningRound.systemId, parent.id));
    const round = (last ?? 0) + 1;
    const roundId = newId();
    await tx.insert(planningRound).values({ id: roundId, systemId: parent.id, number: round, authorUserId: actor.userId, agent: actor.agent ?? null });
    const itemIds = input.items.map(() => newId());
    await tx.insert(planningItem).values(input.items.map((item, i) => ({ id: itemIds[i], roundId, ...item, sortOrder: i })));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "round", newValue: `round ${round}: ${input.items.length} questions` });
    return { round, itemIds };
  });
}

/**
 * Stores the user's answers to planning items of this system. Editor or higher.
 *
 * @throws NotFoundError for an item of another system
 * @throws InvalidError when accepting a risk on an item that is not flagged as one
 * @throws ConflictError if planning is complete
 */
export async function answerPlanningItems(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof answerItemsInput>,
): Promise<{ answered: number }> {
  const input = answerItemsInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    assertOpen(parent);
    const ids = input.answers.map((a) => a.itemId);
    const found = await tx
      .select({ id: planningItem.id, isRisk: planningItem.isRisk })
      .from(planningItem)
      .innerJoin(planningRound, eq(planningRound.id, planningItem.roundId))
      .where(and(eq(planningRound.systemId, parent.id), inArray(planningItem.id, ids)));
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const a of input.answers) {
      const item = byId.get(a.itemId);
      if (!item) throw new NotFoundError(`Unknown planning item ${a.itemId}.`);
      if (a.status === "accepted-risk" && !item.isRisk) {
        throw new InvalidError(`Item ${a.itemId} is not a flagged risk; answer it instead of accepting it.`);
      }
    }
    for (const a of input.answers) {
      await tx.update(planningItem).set({ answer: a.answer, status: a.status }).where(eq(planningItem.id, a.itemId));
    }
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "answers", newValue: `${input.answers.length} answered` });
    return { answered: input.answers.length };
  });
}

/**
 * Completes a system's planning with the user's verbatim confirmation. Editor or higher.
 *
 * @throws ConflictError listing every gap from {@link planningGaps}
 */
export async function completePlanning(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof completePlanningInput>,
): Promise<{ completedAt: Date }> {
  const input = completePlanningInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    if (parent.planningCompletedAt) return { completedAt: parent.planningCompletedAt };
    const gaps = await planningGaps(tx, parent.id);
    if (gaps.length > 0) throw new ConflictError(`Planning of system ${parent.slug} is not complete: ${gaps.join(" ")}`);
    const completedAt = new Date();
    await tx.update(system).set({ planningCompletedAt: completedAt, planningConfirmation: input.userConfirmation }).where(eq(system.id, parent.id));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "completed", newValue: input.userConfirmation });
    return { completedAt };
  });
}

/** Reopens a system's planning and returns it to its board's planning column. Editor or higher. */
export async function reopenPlanning(db: Db, actor: Actor, projectSlug: string, systemSlug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    const boards = await loadBoards(tx, parent.projectId);
    const planningColumn = boards.find((b) => b.id === parent.boardId)?.columns.find((c) => c.category === "planning");
    if (!planningColumn) throw new ConflictError(`The board of system ${parent.slug} has no planning column.`);
    await tx
      .update(system)
      .set({ planningCompletedAt: null, planningConfirmation: null, columnId: planningColumn.id })
      .where(eq(system.id, parent.id));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "reopened" });
  });
}
```

- [ ] **Step 4: Make the move gate list the gaps**

In `src/lib/ops/systems.ts`, add `import { planningGaps } from "./planning";` and replace

```ts
      throw new ConflictError(planningGateMessage(current.slug, []));
```

with

```ts
      throw new ConflictError(planningGateMessage(current.slug, await planningGaps(tx, current.id)));
```

In `src/lib/ops/tasks.ts`, replace the task gate message the same way so agents see what is missing:

```ts
      throw new ConflictError(
        `Task ${taskId} cannot be ${patch.state} while system ${parent.slug} is still in planning. Missing: ${(await planningGaps(tx, parent.id)).join(" ")}`,
      );
```

with `import { planningGaps } from "./planning";` at the top. Update the expectation in `src/lib/ops/tasks.test.ts` from `message: \`Task ${id} cannot be doing while system s is still in planning.\`` to `message: expect.stringContaining(\`Task ${id} cannot be doing while system s is still in planning. Missing:\`)`.

- [ ] **Step 5: Run and commit**

```bash
npm test
git add -A
git commit -m "feat: Add planning rounds and the server-enforced planning gate"
```

Expected: all tests pass, including the updated systems and tasks tests.

---

### Task 4.3: ADRs

**Files:**
- Create: `src/lib/ops/adrs.ts`
- Test: `src/lib/ops/adrs.test.ts`

**Interfaces:**
- Produces:
  - `formatAdrNumber(n: number): string` (`1` → `0001`)
  - `createAdrInput` (zod `{ title, context, decision, alternatives, consequences, systems: slug[] }`), `updateAdrInput` (same fields, all optional), `adrFilter` (zod `{ status?, system? }`)
  - `interface AdrSummary { number: number; title: string; status: AdrStatus; author: string; createdAt: Date; acceptedAt: Date | null; supersedes: number | null; supersededBy: number | null; systems: string[] }`
  - `interface AdrDetail extends AdrSummary { context: string; decision: string; alternatives: string; consequences: string }`
  - `createAdr(db: Db, actor, projectSlug, raw): Promise<{ number: number }>` (editor)
  - `listAdrs(db: Executor, actor, projectSlug, raw?): Promise<AdrSummary[]>` (viewer, by number)
  - `getAdr(db: Executor, actor, projectSlug, number: number): Promise<AdrDetail>` (viewer)
  - `updateAdr(db: Db, actor, projectSlug, number: number, raw): Promise<void>` (editor, proposed only)
  - `acceptAdr(db: Db, actor, projectSlug, number: number): Promise<void>` (editor)
  - `supersedeAdr(db: Db, actor, projectSlug, input: { number: number; by: number }): Promise<void>` (editor)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/adrs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { acceptAdr, createAdr, formatAdrNumber, getAdr, listAdrs, supersedeAdr, updateAdr } from "./adrs";
import { createSystem } from "./systems";

/** A complete ADR body with the given title. */
const body = (title: string) => ({
  title,
  context: "Why",
  decision: "What",
  alternatives: "Option B: faster, but…",
  consequences: "Gives, costs, follow-on, forecloses",
});

describe("ADRs", () => {
  it("formats numbers with four digits", () => {
    expect(formatAdrNumber(7)).toBe("0007");
    expect(formatAdrNumber(12345)).toBe("12345");
  });

  it("numbers ADRs per project, also under parallel creation", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const created = await Promise.all(["A", "B", "C"].map((t) => createAdr(db, owner, slug, body(t))));
    expect(created.map((c) => c.number).sort()).toEqual([1, 2, 3]);
    expect((await createAdr(db, other.owner, "other", body("X"))).number).toBe(1);
  });

  it("links systems and edits only while proposed", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { number } = await createAdr(db, owner, slug, { ...body("Use Postgres"), systems: ["s"] });
    await updateAdr(db, owner, slug, number, { decision: "Use Postgres 17" });
    await acceptAdr(db, owner, slug, number);
    const adr = await getAdr(db, owner, slug, number);
    expect(adr).toMatchObject({ status: "accepted", decision: "Use Postgres 17", systems: ["s"] });
    await expect(updateAdr(db, owner, slug, number, { decision: "SQLite" })).rejects.toMatchObject({
      status: 409,
      message: "ADR 0001 is accepted and can no longer be edited; write a new ADR that supersedes it.",
    });
    await expect(acceptAdr(db, owner, slug, number)).rejects.toMatchObject({ status: 409, message: "ADR 0001 is already accepted." });
    expect((await listAdrs(db, owner, slug, { system: "s" })).map((a) => a.number)).toEqual([1]);
  });

  it("supersedes an accepted ADR with another accepted one", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createAdr(db, owner, slug, body("Old"));
    await createAdr(db, owner, slug, body("New"));
    await acceptAdr(db, owner, slug, 1);
    await expect(supersedeAdr(db, owner, slug, { number: 1, by: 2 })).rejects.toMatchObject({
      status: 409,
      message: "ADR 0002 must be accepted before it can supersede another.",
    });
    await acceptAdr(db, owner, slug, 2);
    await supersedeAdr(db, owner, slug, { number: 1, by: 2 });
    const list = await listAdrs(db, owner, slug);
    expect(list.map((a) => [a.number, a.status, a.supersedes, a.supersededBy])).toEqual([
      [1, "superseded", null, 2],
      [2, "accepted", 1, null],
    ]);
    await expect(supersedeAdr(db, owner, slug, { number: 2, by: 2 })).rejects.toMatchObject({ status: 400 });
  });

  it("reports unknown numbers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(getAdr(db, owner, slug, 5)).rejects.toMatchObject({ status: 404, message: "Unknown ADR 0005." });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/adrs.test.ts`
Expected: FAIL, `./adrs` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/adrs.ts`:

```ts
import { and, asc, eq, inArray, max, type SQL } from "drizzle-orm";
import { z } from "zod";
import { adr, ADR_STATUSES, adrSystem, project, system, user, type AdrStatus } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorLabel, type Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem } from "./lookup";

/** A required ADR section. */
const section = z.string().trim().min(1).max(20000);

/** Input of {@link createAdr}. */
export const createAdrInput = z.object({
  title: z.string().trim().min(1).max(200),
  context: section,
  decision: section,
  alternatives: section,
  consequences: section,
  systems: z.array(slugSchema).max(50).default([]),
});

/** Input of {@link updateAdr}; omitted fields stay unchanged. */
export const updateAdrInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  context: section.optional(),
  decision: section.optional(),
  alternatives: section.optional(),
  consequences: section.optional(),
  systems: z.array(slugSchema).max(50).optional(),
});

/** Filters of {@link listAdrs}. */
export const adrFilter = z.object({ status: z.enum(ADR_STATUSES).optional(), system: z.string().optional() });

/** An ADR as listed. */
export interface AdrSummary {
  number: number;
  title: string;
  status: AdrStatus;
  author: string;
  createdAt: Date;
  acceptedAt: Date | null;
  supersedes: number | null;
  supersededBy: number | null;
  systems: string[];
}

/** An ADR with its sections. */
export interface AdrDetail extends AdrSummary {
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
}

/** Returns an ADR number zero-padded to four digits. */
export function formatAdrNumber(n: number): string {
  return String(n).padStart(4, "0");
}

/** Loads the ADR with `number` in the project, optionally locked, or throws `NotFoundError`. */
async function findAdr(tx: Executor, projectId: string, number: number, lock = false) {
  const query = tx
    .select()
    .from(adr)
    .where(and(eq(adr.projectId, projectId), eq(adr.number, number)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new NotFoundError(`Unknown ADR ${formatAdrNumber(number)}.`);
  return row;
}

/** Replaces the systems linked to an ADR with the systems named by slug. */
async function linkSystems(tx: Tx, projectId: string, adrId: string, slugs: string[]): Promise<void> {
  await tx.delete(adrSystem).where(eq(adrSystem.adrId, adrId));
  for (const slug of new Set(slugs)) {
    const linked = await findSystem(tx, projectId, slug);
    await tx.insert(adrSystem).values({ adrId, systemId: linked.id });
  }
}

/** Loads summaries (and sections) of ADRs matching `where`, ordered by number. */
async function loadAdrs(db: Executor, projectId: string, where?: SQL): Promise<AdrDetail[]> {
  const rows = await db
    .select({ adr, authorName: user.name })
    .from(adr)
    .leftJoin(user, eq(user.id, adr.authorUserId))
    .where(where ? and(eq(adr.projectId, projectId), where) : eq(adr.projectId, projectId))
    .orderBy(asc(adr.number));
  if (rows.length === 0) return [];
  const numbers = new Map(
    (await db.select({ id: adr.id, number: adr.number }).from(adr).where(eq(adr.projectId, projectId))).map((r) => [r.id, r.number]),
  );
  const links = await db
    .select({ adrId: adrSystem.adrId, slug: system.slug })
    .from(adrSystem)
    .innerJoin(system, eq(system.id, adrSystem.systemId))
    .where(inArray(adrSystem.adrId, rows.map((r) => r.adr.id)))
    .orderBy(asc(system.slug));
  return rows.map(({ adr: a, authorName }) => ({
    number: a.number,
    title: a.title,
    status: a.status,
    author: authorLabel(authorName, a.agent),
    createdAt: a.createdAt,
    acceptedAt: a.acceptedAt,
    supersedes: a.supersedesId ? (numbers.get(a.supersedesId) ?? null) : null,
    supersededBy: a.supersededById ? (numbers.get(a.supersededById) ?? null) : null,
    systems: links.filter((l) => l.adrId === a.id).map((l) => l.slug),
    context: a.context,
    decision: a.decision,
    alternatives: a.alternatives,
    consequences: a.consequences,
  }));
}

/**
 * Creates a proposed ADR with the next number of the project. The project row is
 * locked so parallel writers get consecutive numbers. Editor or higher.
 */
export async function createAdr(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createAdrInput>): Promise<{ number: number }> {
  const { systems, ...input } = createAdrInput.parse(raw);
  return db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    await tx.select({ id: project.id }).from(project).where(eq(project.id, found.project.id)).for("update");
    const [{ last }] = await tx.select({ last: max(adr.number) }).from(adr).where(eq(adr.projectId, found.project.id));
    const number = (last ?? 0) + 1;
    const id = newId();
    await tx.insert(adr).values({ id, projectId: found.project.id, number, ...input, authorUserId: actor.userId, agent: actor.agent ?? null });
    await linkSystems(tx, found.project.id, id, systems);
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: id, field: "created", newValue: `ADR ${formatAdrNumber(number)}: ${input.title}` });
    return { number };
  });
}

/** Lists the project's ADRs by number, optionally by status or linked system. */
export async function listAdrs(db: Executor, actor: Actor, projectSlug: string, raw: z.input<typeof adrFilter> = {}): Promise<AdrSummary[]> {
  const filter = adrFilter.parse(raw);
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const all = await loadAdrs(db, found.id, filter.status ? eq(adr.status, filter.status) : undefined);
  const matching = filter.system ? all.filter((a) => a.systems.includes(filter.system as string)) : all;
  return matching.map(({ context: _c, decision: _d, alternatives: _a, consequences: _q, ...summary }) => summary);
}

/** Returns one ADR with its sections. */
export async function getAdr(db: Executor, actor: Actor, projectSlug: string, number: number): Promise<AdrDetail> {
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const [row] = await loadAdrs(db, found.id, eq(adr.number, number));
  if (!row) throw new NotFoundError(`Unknown ADR ${formatAdrNumber(number)}.`);
  return row;
}

/**
 * Edits a proposed ADR. Editor or higher.
 *
 * @throws ConflictError if the ADR is accepted or superseded
 */
export async function updateAdr(db: Db, actor: Actor, projectSlug: string, number: number, raw: z.input<typeof updateAdrInput>): Promise<void> {
  const { systems, ...patch } = updateAdrInput.parse(raw);
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findAdr(tx, found.project.id, number, true);
    if (current.status !== "proposed") {
      throw new ConflictError(`ADR ${formatAdrNumber(number)} is ${current.status} and can no longer be edited; write a new ADR that supersedes it.`);
    }
    if (Object.keys(patch).length > 0) await tx.update(adr).set(patch).where(eq(adr.id, current.id));
    if (systems) await linkSystems(tx, found.project.id, current.id, systems);
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: current.id, field: "edited", newValue: Object.keys({ ...patch, ...(systems ? { systems } : {}) }).join(", ") });
  });
}

/**
 * Accepts a proposed ADR; from then on it is immutable. Editor or higher.
 *
 * @throws ConflictError if it is not proposed
 */
export async function acceptAdr(db: Db, actor: Actor, projectSlug: string, number: number): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findAdr(tx, found.project.id, number, true);
    if (current.status !== "proposed") throw new ConflictError(`ADR ${formatAdrNumber(number)} is already ${current.status}.`);
    await tx.update(adr).set({ status: "accepted", acceptedAt: new Date() }).where(eq(adr.id, current.id));
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: current.id, field: "status", oldValue: "proposed", newValue: "accepted" });
  });
}

/**
 * Marks accepted ADR `number` as superseded by accepted ADR `by`, linking both.
 * No section of either ADR changes. Editor or higher.
 *
 * @throws InvalidError if both numbers are the same
 * @throws ConflictError if either ADR is not accepted
 */
export async function supersedeAdr(db: Db, actor: Actor, projectSlug: string, input: { number: number; by: number }): Promise<void> {
  if (input.number === input.by) throw new InvalidError("An ADR cannot supersede itself.");
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const old = await findAdr(tx, found.project.id, input.number, true);
    const next = await findAdr(tx, found.project.id, input.by, true);
    if (old.status !== "accepted") throw new ConflictError(`ADR ${formatAdrNumber(input.number)} is ${old.status}; only accepted ADRs can be superseded.`);
    if (next.status !== "accepted") throw new ConflictError(`ADR ${formatAdrNumber(input.by)} must be accepted before it can supersede another.`);
    await tx.update(adr).set({ status: "superseded", supersededById: next.id }).where(eq(adr.id, old.id));
    await tx.update(adr).set({ supersedesId: old.id }).where(eq(adr.id, next.id));
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: old.id, field: "status", oldValue: "accepted", newValue: `superseded by ${formatAdrNumber(input.by)}` });
  });
}
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/lib/ops/adrs.test.ts
git add -A
git commit -m "feat: Add numbered, immutable ADRs with superseding"
```

---

### Task 4.4: System overview

**Files:**
- Create: `src/lib/ops/overview.ts`
- Test: `src/lib/ops/overview.test.ts`

**Interfaces:**
- Produces:
  - `interface SystemOverview extends SystemDetail { spec: DocumentView | null; plan: DocumentView | null; planning: { complete: boolean; gaps: string[]; rounds: number }; questions: QuestionItem[]; adrs: AdrSummary[]; updates: UpdateItem[] }`
  - `getSystemOverview(db: Executor, actor: Actor, projectSlug: string, systemSlug: string, updatesLimit?: number): Promise<SystemOverview>` (viewer; `updatesLimit` default 10)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/overview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { createAdr } from "./adrs";
import { writeSpec } from "./documents";
import { getSystemOverview } from "./overview";
import { addPlanningRound } from "./planning";
import { addQuestion } from "./questions";
import { createSystem } from "./systems";
import { postUpdate } from "./updates";

describe("getSystemOverview", () => {
  it("combines system, documents, planning state, questions, ADRs and updates", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    await addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "?" }] });
    await addQuestion(db, owner, slug, { title: "Q?", system: "s" });
    await createAdr(db, owner, slug, { title: "A", context: "c", decision: "d", alternatives: "a", consequences: "q", systems: ["s"] });
    await postUpdate(db, owner, slug, "s", { summary: "Started" });
    const o = await getSystemOverview(db, owner, slug, "s");
    expect(o.spec?.body).toBe("# Spec");
    expect(o.plan).toBeNull();
    expect(o.planning).toMatchObject({ complete: false, rounds: 1 });
    expect(o.planning.gaps.length).toBeGreaterThan(0);
    expect(o.questions.map((q) => q.title)).toEqual(["Q?"]);
    expect(o.adrs.map((a) => a.number)).toEqual([1]);
    expect(o.updates.map((u) => u.summary)).toEqual(["Started"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/overview.test.ts`
Expected: FAIL, `./overview` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/overview.ts`:

```ts
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { listAdrs, type AdrSummary } from "./adrs";
import { latestDocument, type DocumentView } from "./documents";
import { getPlanning } from "./planning";
import { listQuestions, type QuestionItem } from "./questions";
import { getSystem, type SystemDetail } from "./systems";
import { listUpdates, type UpdateItem } from "./updates";

/** Everything known about one system, as agents and the system page need it. */
export interface SystemOverview extends SystemDetail {
  spec: DocumentView | null;
  plan: DocumentView | null;
  planning: { complete: boolean; gaps: string[]; rounds: number };
  questions: QuestionItem[];
  adrs: AdrSummary[];
  updates: UpdateItem[];
}

/**
 * Returns a system with its latest spec and plan, planning state, questions,
 * linked ADRs and its newest progress updates.
 *
 * @param updatesLimit how many updates to include, newest first
 */
export async function getSystemOverview(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  updatesLimit = 10,
): Promise<SystemOverview> {
  const detail = await getSystem(db, actor, projectSlug, systemSlug);
  const [spec, plan, planning, questions, adrs, updates] = await Promise.all([
    latestDocument(db, detail.system.id, "spec"),
    latestDocument(db, detail.system.id, "plan"),
    getPlanning(db, actor, projectSlug, systemSlug),
    listQuestions(db, actor, projectSlug, { system: systemSlug }),
    listAdrs(db, actor, projectSlug, { system: systemSlug }),
    listUpdates(db, actor, projectSlug, { system: systemSlug, limit: updatesLimit }),
  ]);
  return {
    ...detail,
    spec,
    plan,
    planning: { complete: planning.completedAt !== null, gaps: planning.gaps, rounds: planning.rounds.length },
    questions,
    adrs,
    updates,
  };
}
```

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run lint && npm run typecheck
git add -A
git commit -m "feat: Add the system overview read"
```
