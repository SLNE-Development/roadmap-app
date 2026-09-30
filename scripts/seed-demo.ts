/**
 * Fills the database at DATABASE_URL with ten demo projects for local development.
 *
 * Run with `npm run db:seed`. The first admin user owns every project; eleven demo
 * users (emails at demo.roadmap.test) join as owners, editors and viewers. All
 * writes go through the ops layer, so the change log, planning gate and numbering
 * behave as in the app. Timestamps are then spread over the last weeks.
 * Re-running first deletes the demo projects and demo users, nothing else.
 */
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { allowedAccount, changeLog, project, task, user, type ColumnCategory, type PlanningArea, type Priority, type TaskState } from "@/db/schema";
import type { Db } from "@/db/types";
import { newId } from "@/lib/id";
import { acceptAdr, createAdr, supersedeAdr } from "@/lib/ops/adrs";
import { withAgent, type Actor } from "@/lib/ops/actor";
import { createBoard, setBoardColumns } from "@/lib/ops/boards";
import { writePlan, writeSpec } from "@/lib/ops/documents";
import { setMember } from "@/lib/ops/members";
import { addPlanningRound, answerPlanningItems, completePlanning, getPlanning } from "@/lib/ops/planning";
import { createProject } from "@/lib/ops/projects";
import { addQuestion, answerQuestion } from "@/lib/ops/questions";
import { createDomain, createPhase } from "@/lib/ops/structure";
import { createSystem, moveSystem, updateSystem } from "@/lib/ops/systems";
import { addTask, updateTask } from "@/lib/ops/tasks";
import { postUpdate } from "@/lib/ops/updates";
import { DEMO_PEOPLE, PHASES, PROJECTS, type SeedProject, type SeedSystem } from "./seed-data";

const DEMO_DOMAIN = "demo.roadmap.test";
const DAY = 86_400_000;

/** Deterministic PRNG (mulberry32) so every run produces the same data. */
let state = 0x5eed;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
function shuffled<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Where each of a project's twelve systems ends up; rotated per project. */
const COLUMN_PATTERN: (ColumnCategory | "planning-empty")[] = [
  "done", "done", "review", "active", "active", "done", "todo", "blocked", "planning", "active", "todo", "planning-empty",
];

const STEP_TEMPLATES = [
  "Sketch the data model for {t}",
  "Write the migration and repository layer",
  "Implement the core service for {t}",
  "Add commands and permissions",
  "Wire events into the message bus",
  "Build the player-facing UI",
  "Add config options with sane defaults",
  "Write integration tests against a test server",
  "Add metrics and structured logs",
  "Load test with 200 simulated players",
  "Document the admin commands",
  "Roll out behind a feature flag",
  "Review translations and copy",
  "Remove the legacy code path",
];

const EXTRA_TASKS = ["Fix edge case reported in beta", "Clean up TODOs before merge", "Pair review with {p}", "Update the changelog", "Check behaviour after server restart"];

const PLANNING_QUESTIONS: Record<PlanningArea, string[]> = {
  "failure-modes": [
    "What happens to {t} when the database is unreachable for a minute?",
    "How does {t} behave if a player disconnects halfway through?",
    "What do we do if two servers write the same record at once?",
  ],
  dependencies: ["Which services does {t} call, and which call it?", "Does {t} need anything from the economy or permissions APIs?", "What has to ship before {t} can start?"],
  scope: ["What is explicitly out of scope for the first version of {t}?", "Which part of {t} is MVP and which can wait?", "Do we need an admin UI for {t} at launch?"],
  "ops-testing": ["How do we test {t} without real players?", "Which metrics tell us {t} is healthy?", "How do we roll {t} back if it misbehaves?"],
};

const PLANNING_ANSWERS: Record<PlanningArea, string[]> = {
  "failure-modes": ["Writes queue in memory for up to 60 seconds and retry; after that the action fails with a clear message.", "The state is kept for five minutes so the player can resume after reconnecting.", "Writes carry a version; the second writer retries on conflict."],
  dependencies: ["Only the player service and the shared config; nothing depends on it yet.", "Economy for payouts and LuckPerms for permissions, both through their public APIs.", "The shared data model from Foundations must be merged first."],
  scope: ["No cross-server support and no web UI in v1.", "The core flow is MVP; statistics and cosmetics come later.", "No, commands are enough at launch; a panel follows in Live ops."],
  "ops-testing": ["Integration tests with MockBukkit plus a bot swarm on staging.", "Error rate, p95 latency of the main action and active users per hour.", "Everything sits behind a feature flag that staff can flip in game."],
};

const RISKS = [
  "Could {t} be abused to duplicate items or money?",
  "Is there a performance risk for {t} at 500 concurrent players?",
  "Could {t} leak data between players?",
];

const QUESTION_TEMPLATES = [
  "Who owns {t} after launch?",
  "What happens to {t} data when a player is deleted?",
  "Do we need a feature flag for {t}?",
  "How do we load test {t}?",
  "Should {t} be configurable per server?",
  "Is {t} blocked by the permissions rework?",
  "Can we reuse the existing UI kit for {t}?",
  "Does {t} need translations before beta?",
];

const PROJECT_QUESTIONS = [
  { title: "Which Paper version do we target for launch?", text: "1.21.4 is stable for us, but 1.21.8 fixes the chunk loading issue." },
  { title: "Do we need a staging environment per branch?", text: "Preview servers per PR would help review but cost host hours." },
  { title: "Who signs off on releases?", text: "Right now whoever merges also deploys. Should a second person approve?" },
  { title: "What is our uptime target?", text: "We have never written one down. 99.5% would allow about 3.6 hours a month." },
];

const UPDATE_SUMMARIES = [
  "Finished the first pass of {s}; tests are green locally.",
  "Merged {s}. Found a race with concurrent writes, fixed with a version check.",
  "{s} works on staging; waiting for a second review.",
  "Spent the day on {s}. The config format changed, migration written.",
  "Paired on {s}; split it into two smaller steps.",
  "{s} is done except for the translations.",
  "Blocked on {s}: the upstream API returns stale data after restarts.",
  "Profiled {s}: p95 went from 38 ms to 6 ms after batching the queries.",
];

const NEXT_STEPS = ["Write the integration test", "Ask for review", "Deploy to staging", "Update the docs", "Start the next plan step", "Sync with the owner of the upstream API"];

const AGENTS = ["claude-code", "claude-code", "codex"];

/** Replaces `{t}` in a template. */
const fill = (template: string, t: string) => template.replaceAll("{t}", t);

function specBody(p: SeedProject, s: SeedSystem): string {
  return `# ${s.title}

${s.summary}

## Goal

Give players of ${p.name} a dependable ${s.title.toLowerCase()} that staff can operate without developer help.

## Behaviour

- The feature is available on every server of the network once the flag is on.
- All state lives in Postgres; servers only cache it.
- Every staff action is logged with the actor and a reason.

## Out of scope

- A web interface (tracked separately).
- Migration of data from the legacy plugin.

## Acceptance

1. The happy path works end to end on staging with two servers.
2. A restart in the middle of an action loses no data.
3. Metrics for errors and latency are visible in Grafana.
`;
}

function planBody(s: SeedSystem, steps: { step: number; title: string }[]): string {
  return `# Plan: ${s.title}

Each step ends in a state we can verify before starting the next.

${steps.map((st) => `${st.step}. **${st.title}**: done when it is merged and covered by a test.`).join("\n")}

## Risks

- The data model may need a second iteration after the content pass.
`;
}

function adrSections(p: SeedProject, title: string) {
  return {
    context: `${p.name} needs a decision on this before the next phase. The current approach grew organically and nobody owns it, which led to two incidents last quarter and slows down every new system that touches it.`,
    decision: `${title}. We apply this to all new code immediately and migrate existing code as we touch it.`,
    alternatives: "- Keep the status quo: cheapest now, but the incidents will repeat.\n- Buy a hosted product: faster to start, but it adds a vendor and a monthly cost.\n- Build a larger framework first: cleaner, but delays the roadmap by a phase.",
    consequences: "- Everyone follows one pattern, which makes reviews faster.\n- Some existing modules need a migration, estimated at two weeks.\n- We accept a small performance cost in exchange for simpler operations.",
  };
}

async function reset(db: Db): Promise<void> {
  await db.delete(project).where(inArray(project.slug, PROJECTS.map((p) => p.slug)));
  const demoUsers = await db.select({ discordId: user.discordId }).from(user).where(like(user.email, `%@${DEMO_DOMAIN}`));
  await db.delete(user).where(like(user.email, `%@${DEMO_DOMAIN}`));
  const ids = demoUsers.flatMap((u) => (u.discordId ? [u.discordId] : []));
  if (ids.length > 0) await db.delete(allowedAccount).where(inArray(allowedAccount.discordId, ids));
}

async function createPeople(db: Db): Promise<Actor[]> {
  const people: Actor[] = [];
  for (const [i, name] of DEMO_PEOPLE.entries()) {
    const id = newId();
    const discordId = String(900000000000000000n + BigInt(i + 1));
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${DEMO_DOMAIN}`;
    await db.insert(user).values({ id, name, email, discordId, emailVerified: true });
    await db.insert(allowedAccount).values({ discordId, displayName: name });
    people.push({ userId: id, name, isAdmin: false });
  }
  return people;
}

/** Runs a planning interview; `complete` answers every item, otherwise two stay open. */
async function plan(db: Db, lead: Actor, p: SeedProject, s: SeedSystem, complete: boolean): Promise<void> {
  const areas = Object.keys(PLANNING_QUESTIONS) as PlanningArea[];
  const items = areas.map((area) => ({ area, question: fill(pick(PLANNING_QUESTIONS[area]), s.title) }));
  items.push({ area: "failure-modes", question: fill(pick(RISKS), s.title), isRisk: true } as (typeof items)[number]);
  const agentLead = withAgent(lead, pick(AGENTS));
  await addPlanningRound(db, agentLead, p.slug, s.slug, { items });
  let view = await getPlanning(db, lead, p.slug, s.slug);
  const round1 = view.rounds[0].items;
  const toAnswer = complete ? round1 : round1.slice(0, 3);
  await answerPlanningItems(db, lead, p.slug, s.slug, {
    answers: toAnswer.map((it) => ({
      itemId: it.id,
      answer: it.isRisk ? "Accepted for v1: the flow is rate-limited and every action is logged, so abuse is visible and reversible." : pick(PLANNING_ANSWERS[it.area]),
      status: it.isRisk ? ("accepted-risk" as const) : ("answered" as const),
    })),
  });
  if (!complete) return;
  if (rand() < 0.5) {
    await addPlanningRound(db, agentLead, p.slug, s.slug, {
      items: [
        { area: "scope", question: fill("Follow-up: does {t} need to work across servers in v1?", s.title) },
        { area: "ops-testing", question: fill("Follow-up: who is paged if {t} fails at night?", s.title) },
      ],
    });
    view = await getPlanning(db, lead, p.slug, s.slug);
    await answerPlanningItems(db, lead, p.slug, s.slug, {
      answers: view.rounds[1].items.map((it) => ({ itemId: it.id, answer: pick(PLANNING_ANSWERS[it.area]) })),
    });
  }
}

async function seedSystem(
  db: Db,
  p: SeedProject,
  s: SeedSystem,
  target: ColumnCategory | "planning-empty",
  ctx: { board: string; columns: Map<ColumnCategory, string>; domainIds: string[]; phaseIds: string[]; editors: Actor[]; members: Actor[] },
): Promise<void> {
  const lead = pick(ctx.editors);
  await createSystem(db, lead, p.slug, {
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    board: ctx.board,
    domainId: ctx.domainIds[s.domain],
    phaseId: ctx.phaseIds[s.phase],
    priority: s.priority,
  });
  if (rand() < 0.4) {
    await updateSystem(db, lead, p.slug, s.slug, { notes: `Talked to staff about ${s.title.toLowerCase()} on Discord; they mostly care about clear feedback messages.\n\n- Keep commands short\n- Add a /help entry` });
  }

  if (target === "planning-empty") {
    for (const title of STEP_TEMPLATES.slice(0, 3)) await addTask(db, lead, p.slug, s.slug, { title: fill(title, s.title), priority: s.priority });
    return;
  }
  if (target === "planning") {
    await plan(db, lead, p, s, false);
    await writeSpec(db, withAgent(lead, "claude-code"), p.slug, s.slug, { body: specBody(p, s) });
    for (const title of STEP_TEMPLATES.slice(0, 10)) await addTask(db, lead, p.slug, s.slug, { title: fill(title, s.title) });
    return;
  }

  await plan(db, lead, p, s, true);
  await writeSpec(db, withAgent(lead, "claude-code"), p.slug, s.slug, { body: specBody(p, s) });
  if (rand() < 0.4) {
    await writeSpec(db, lead, p.slug, s.slug, { body: `${specBody(p, s)}\n## Changes in v2\n\n- Clarified behaviour on restart after review feedback.\n` });
  }
  await completePlanning(db, lead, p.slug, s.slug, { userConfirmation: `Yes, the spec for ${s.title} matches what we want. Go ahead.` });

  const steps = shuffled(STEP_TEMPLATES)
    .slice(0, 10)
    .map((title, i) => ({ step: i + 1, title: fill(title, s.title) }));
  await writePlan(db, withAgent(lead, pick(AGENTS)), p.slug, s.slug, { body: planBody(s, steps), steps });
  if (rand() < 0.3) {
    await writePlan(db, withAgent(lead, "claude-code"), p.slug, s.slug, { body: `${planBody(s, steps)}\nRevised after step 3: steps 4 and 5 swapped.\n`, steps });
  }
  for (const extra of shuffled(EXTRA_TASKS).slice(0, 2)) {
    await addTask(db, lead, p.slug, s.slug, { title: extra.replace("{p}", pick(ctx.members).name), priority: pick<Priority>(["MVP", "Later", "Nice to have"]) });
  }

  const column = ctx.columns.get(target) as string;
  await moveSystem(db, lead, p.slug, s.slug, { board: ctx.board, column });

  const [sys] = await db.select({ id: schema.system.id }).from(schema.system).innerJoin(project, eq(project.id, schema.system.projectId)).where(and(eq(project.slug, p.slug), eq(schema.system.slug, s.slug)));
  const tasks = await db.select({ id: task.id, title: task.title }).from(task).where(eq(task.systemId, sys.id)).orderBy(asc(task.sortOrder));
  const done = { done: tasks.length, review: tasks.length - 1, active: Math.floor(tasks.length * (0.3 + rand() * 0.4)), blocked: Math.floor(tasks.length * 0.4), todo: 0 }[target as "done" | "review" | "active" | "blocked" | "todo"];
  for (const [i, t] of tasks.entries()) {
    let next: TaskState = "todo";
    if (i < done) next = "done";
    else if (i === done && (target === "active" || target === "review")) next = "doing";
    else if (i === done && target === "blocked") next = "blocked";
    else if (target === "active" && i === done + 2 && rand() < 0.5) next = "blocked";
    const owner = next !== "todo" || rand() < 0.3 ? pick(ctx.editors) : null;
    if (next === "todo" && !owner) continue;
    await updateTask(db, owner ?? lead, t.id, { state: next, ownerUserId: owner?.userId ?? null });
  }

  if (target === "todo") return;
  const count = target === "done" ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const author = rand() < 0.4 ? withAgent(pick(ctx.editors), pick(AGENTS)) : pick(ctx.editors);
    const t = pick(tasks);
    const summary = target === "blocked" && i === count - 1 ? fill(UPDATE_SUMMARIES[6].replace("{s}", t.title.toLowerCase()), s.title) : pick(UPDATE_SUMMARIES).replace("{s}", t.title.toLowerCase());
    await postUpdate(db, author, p.slug, s.slug, {
      summary: summary.charAt(0).toUpperCase() + summary.slice(1),
      nextStep: target === "done" && i === count - 1 ? undefined : pick(NEXT_STEPS),
      taskId: t.id,
      commit: rand() < 0.7 ? hex(40) : undefined,
    });
  }
}

async function seedProject(db: Db, admin: Actor, people: Actor[], p: SeedProject, index: number): Promise<void> {
  await createProject(db, admin, { slug: p.slug, name: p.name, description: p.description, repoUrl: p.repo });

  const team = shuffled(people).slice(0, 10);
  const roles = ["owner", "editor", "editor", "editor", "editor", "editor", "editor", "viewer", "viewer", "viewer"] as const;
  for (const [i, member] of team.entries()) await setMember(db, admin, p.slug, { userId: member.userId, role: roles[i] });
  const editors = team.slice(0, 7);

  const [second, third] = p.boards.map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  await createBoard(db, admin, p.slug, { slug: second, name: p.boards[0] });
  await createBoard(db, admin, p.slug, { slug: third, name: p.boards[1] });
  const custom = await setBoardColumns(db, admin, p.slug, third, {
    columns: [
      { name: "Backlog", category: "planning" },
      { name: "Ready", category: "todo" },
      { name: "Building", category: "active" },
      { name: "QA", category: "review" },
      { name: "Waiting", category: "blocked" },
      { name: "Shipped", category: "done" },
    ],
  });
  const defaults = new Map<ColumnCategory, string>([
    ["planning", "Planning"], ["todo", "Todo"], ["active", "In progress"], ["review", "Review"], ["blocked", "Blocked"], ["done", "Done"],
  ]);
  const customColumns = new Map(custom.columns.map((c) => [c.category, c.name] as [ColumnCategory, string]));

  const domainIds: string[] = [];
  for (const name of p.domains) domainIds.push((await createDomain(db, pick(editors), p.slug, { name, description: `Everything about ${name.toLowerCase()} in ${p.name}.` })).id);
  const phaseIds: string[] = [];
  for (const [i, ph] of PHASES.entries()) {
    const dependsOn = i === 0 ? [] : i === 4 ? [phaseIds[2], phaseIds[3]] : [phaseIds[i - 1]];
    phaseIds.push((await createPhase(db, admin, p.slug, { name: ph.name, goal: ph.goal, dependsOn })).id);
  }

  for (const [i, s] of p.systems.entries()) {
    const target = COLUMN_PATTERN[(i + index) % COLUMN_PATTERN.length];
    const board = i < 6 ? "development" : i < 9 ? second : third;
    await seedSystem(db, p, s, target, { board, columns: board === third ? customColumns : defaults, domainIds, phaseIds, editors, members: team });
    console.log(`  ${p.slug}/${s.slug} -> ${target}`);
  }

  for (const [i, title] of p.adrs.entries()) {
    const author = rand() < 0.5 ? withAgent(pick(editors), "claude-code") : pick(editors);
    const systems = shuffled(p.systems).slice(0, 1 + Math.floor(rand() * 2)).map((s) => s.slug);
    await createAdr(db, author, p.slug, { title, ...adrSections(p, title), systems });
    if (i < 9) await acceptAdr(db, pick(editors), p.slug, i + 1);
  }
  // The last accepted ADR replaces an earlier one, as the titles suggest ("Replace…", "Retire…").
  await supersedeAdr(db, admin, p.slug, { number: 2, by: 9 });

  const questions = [
    ...shuffled(p.systems).slice(0, 8).map((s) => ({ title: fill(pick(QUESTION_TEMPLATES), s.title), text: `Came up while planning ${s.title.toLowerCase()}.`, system: s.slug })),
    ...PROJECT_QUESTIONS,
  ];
  for (const [i, q] of questions.entries()) {
    const author = rand() < 0.3 ? withAgent(pick(editors), pick(AGENTS)) : pick(editors);
    const { id } = await addQuestion(db, author, p.slug, q);
    if (i % 2 === 0) await answerQuestion(db, pick(editors), p.slug, { id, answer: "Decided in the weekly sync: yes, but only after the beta. Tracked on the board." });
    else if (i % 5 === 0) await answerQuestion(db, pick(editors), p.slug, { id, answer: "Leaning towards no; waiting for numbers from staging.", resolved: false });
  }
}

/** Spreads each project's timestamps linearly over a window ending shortly before now. */
async function spreadTimestamps(db: Db, index: number, slug: string): Promise<void> {
  const [row] = await db.select({ id: project.id }).from(project).where(eq(project.slug, slug));
  const [{ min, max }] = await db
    .select({ min: sql<string>`extract(epoch from min(${changeLog.createdAt}))`, max: sql<string>`extract(epoch from max(${changeLog.createdAt}))` })
    .from(changeLog)
    .where(eq(changeLog.projectId, row.id));
  const lo = Number(min);
  const hi = Math.max(Number(max), lo + 0.001);
  const end = (Date.now() - index * 0.3 * DAY) / 1000;
  const start = end - (50 + index * 4) * (DAY / 1000);
  const k = (end - start) / (hi - lo);
  const map = (col: string) => sql.raw(`${col} = case when ${col} is null then null else to_timestamp(${start} + (extract(epoch from ${col}) - ${lo}) * ${k}) end`);
  const bySystem = sql.raw(`system_id in (select id from system where project_id = '${row.id}')`);
  await db.execute(sql`update project set ${map("created_at")} where id = ${row.id}`);
  await db.execute(sql`update system set ${map("created_at")}, ${map("planning_completed_at")} where project_id = ${row.id}`);
  await db.execute(sql`update change_log set ${map("created_at")} where project_id = ${row.id}`);
  await db.execute(sql`update adr set ${map("created_at")}, ${map("accepted_at")} where project_id = ${row.id}`);
  await db.execute(sql`update question set ${map("created_at")}, ${map("resolved_at")} where project_id = ${row.id}`);
  await db.execute(sql`update system_document set ${map("created_at")} where ${bySystem}`);
  await db.execute(sql`update progress_update set ${map("created_at")} where ${bySystem}`);
  await db.execute(sql`update planning_round set ${map("created_at")} where ${bySystem}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle({ client, schema }) as unknown as Db;
  try {
    const [adminRow] = await db.select().from(user).where(eq(user.isAdmin, true)).orderBy(asc(user.createdAt)).limit(1);
    if (!adminRow) throw new Error("No admin user yet. Sign in once with Discord (the first account becomes admin), then seed.");
    const admin: Actor = { userId: adminRow.id, name: adminRow.name, isAdmin: true };
    console.log(`Seeding as ${admin.name}…`);
    await reset(db);
    const people = await createPeople(db);
    for (const [i, p] of PROJECTS.entries()) {
      console.log(`${p.name}`);
      await seedProject(db, admin, people, p, i);
      await spreadTimestamps(db, i, p.slug);
    }
    console.log(`Done: ${PROJECTS.length} projects, ${people.length} demo users.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
