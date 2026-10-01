import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCall, agentRun, changeLog } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { NotFoundError } from "@/lib/ops/errors";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { callTarget, getRun, listProjectRuns, recordCall, recordUsage, startRun, systemAgentCost, type CallRecord } from "./agent-runs";
import { createSystem } from "./systems";

/** A start time for the grouping tests. */
const T = new Date("2026-10-01T10:00:00Z");

/** Returns `T` plus `minutes`. */
const plus = (minutes: number) => new Date(T.getTime() + minutes * 60_000);

/** A successful call record for `actor` through key `apiKeyId`, overridable per test. */
function rec(actor: Actor, apiKeyId: string, overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    apiKeyId,
    userId: actor.userId,
    agent: "Claude Code",
    tool: "list_systems",
    transport: "mcp",
    input: {},
    ok: true,
    status: 200,
    error: null,
    durationMs: 12,
    at: T,
    ...overrides,
  };
}

/** Returns every run of a key, oldest first. */
async function runsOf(db: Db, apiKeyId: string) {
  return (await db.select().from(agentRun).where(eq(agentRun.apiKeyId, apiKeyId))).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/** Usage totals for a session. */
const usage = (clientSessionId: string, n: number) => ({
  clientSessionId,
  inputTokens: n,
  outputTokens: n * 2,
  cacheReadTokens: n * 3,
  cacheWriteTokens: n * 4,
});

describe("recordCall", () => {
  it("groups a key's calls into runs by the 10-minute rule", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    for (const m of [0, 5, 9]) await recordCall(db, rec(user, "K", { at: plus(m) }));
    let runs = await runsOf(db, "K");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ callCount: 3, errorCount: 0, lastCallAt: plus(9), userId: user.userId });

    await recordCall(db, rec(user, "K", { at: plus(20) }));
    runs = await runsOf(db, "K");
    expect(runs.map((r) => r.callCount)).toEqual([3, 1]);

    await recordCall(db, rec(user, "L", { at: plus(21) }));
    expect((await runsOf(db, "L")).map((r) => r.callCount)).toEqual([1]);
    expect((await runsOf(db, "K")).map((r) => r.callCount)).toEqual([3, 1]);
  });

  it("puts two concurrent first calls of a key into one run", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await Promise.all([recordCall(db, rec(user, "fresh")), recordCall(db, rec(user, "fresh", { at: plus(0.1) }))]);
    const runs = await runsOf(db, "fresh");
    expect(runs).toHaveLength(1);
    expect(runs[0].callCount).toBe(2);
    expect(await db.select().from(agentCall).where(eq(agentCall.runId, runs[0].id))).toHaveLength(2);
  });

  it("stores failed calls with a cut error and counts them", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await recordCall(db, rec(user, "K", { ok: false, status: 400, error: "x".repeat(400) }));
    const [run] = await runsOf(db, "K");
    expect(run.errorCount).toBe(1);
    const [call] = await db.select().from(agentCall);
    expect(call).toMatchObject({ ok: false, status: 400 });
    expect(call.error).toHaveLength(300);
  });

  it("resolves the project, system and target without storing input", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await recordCall(db, rec(owner, "K", { tool: "get_system", input: { project: slug, system: "shop", secret: "s3cret" } }));
    await recordCall(db, rec(owner, "K", { tool: "get_system", input: { project: "nope", system: "shop" }, at: plus(1) }));
    const calls = await db.select().from(agentCall).orderBy(agentCall.id);
    expect(calls.map((c) => [c.projectId, c.systemSlug, c.target, c.agent, c.transport])).toEqual([
      [projectId, "shop", "shop", "Claude Code", "mcp"],
      [null, "shop", "shop", "Claude Code", "mcp"],
    ]);
    expect(JSON.stringify(calls)).not.toContain("s3cret");
  });
});

describe("callTarget", () => {
  it("names tasks, batches, documents, ADRs and systems", () => {
    expect(callTarget("update_task", { id: 188 })).toBe("task #188");
    expect(callTarget("add_tasks", { tasks: [{}, {}] })).toBe("2 tasks");
    expect(callTarget("get_document", { kind: "plan", version: 3 })).toBe("plan v3");
    expect(callTarget("accept_adr", { number: 4 })).toBe("ADR 4");
    expect(callTarget("get_system", { system: "shop" })).toBe("shop");
    expect(callTarget("list_projects", {})).toBeNull();
  });
});

describe("startRun", () => {
  it("starts a run the key's next calls join, keeping its title", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    const { runId } = await startRun(db, user, "K", { title: "Fix login", repo: "roadmap-app", branch: "main" });
    await recordCall(db, rec(user, "K", { at: new Date() }));
    const runs = await runsOf(db, "K");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: runId, title: "Fix login", repo: "roadmap-app", branch: "main", callCount: 1 });
  });

  it("returns the same run for the same client session id", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    const first = await startRun(db, user, "K", { title: "One", clientSessionId: "sess-1" });
    const second = await startRun(db, user, "K", { title: "Two", clientSessionId: "sess-1" });
    expect(second.runId).toBe(first.runId);
    const runs = await runsOf(db, "K");
    expect(runs).toHaveLength(1);
    expect(runs[0].title).toBe("Two");
  });
});

describe("session runs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a started run current through usage reports", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const { runId } = await startRun(db, user, "K", { title: "Fix login", clientSessionId: "sess-1" });
    vi.setSystemTime(plus(5));
    await recordUsage(db, user, "K", usage("sess-1", 1));
    await recordCall(db, rec(user, "K", { at: plus(15) }));
    const runs = await runsOf(db, "K");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: runId, callCount: 1, lastCallAt: plus(15) });
  });

  it("gives a run with a client session id a 60-minute gap", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const { runId } = await startRun(db, user, "K", { clientSessionId: "sess-1" });
    await recordCall(db, rec(user, "K", { at: plus(45) }));
    await recordCall(db, rec(user, "K", { at: plus(110) }));
    const runs = await runsOf(db, "K");
    expect(runs.map((r) => [r.id === runId, r.callCount])).toEqual([
      [true, 1],
      [false, 1],
    ]);
  });
});

describe("recordUsage", () => {
  it("sets token totals instead of adding to them", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    const { runId } = await startRun(db, user, "K", { clientSessionId: "sess-1" });
    await recordUsage(db, user, "K", usage("sess-1", 10));
    await recordUsage(db, user, "K", usage("sess-1", 25));
    const [run] = await db.select().from(agentRun).where(eq(agentRun.id, runId));
    expect(run).toMatchObject({ inputTokens: 25, outputTokens: 50, cacheReadTokens: 75, cacheWriteTokens: 100 });
  });

  it("creates a run for an unknown session", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await recordUsage(db, user, "K", usage("sess-new", 7));
    const runs = await runsOf(db, "K");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ clientSessionId: "sess-new", inputTokens: 7, userId: user.userId });
  });

  it("refuses another user's session", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    const other = await insertUser(db);
    await startRun(db, user, "K", { clientSessionId: "sess-1" });
    await expect(recordUsage(db, other, "L", usage("sess-1", 1))).rejects.toBeInstanceOf(NotFoundError);
  });
});

/** Records a call of `actor` at `at` in `slug`, on `system` when given. */
async function call(db: Db, actor: Actor, key: string, slug: string, at: Date, system?: string, overrides: Partial<CallRecord> = {}) {
  await recordCall(db, rec(actor, key, { at, input: { project: slug, ...(system ? { system } : {}) }, ...overrides }));
}

describe("listProjectRuns", () => {
  it("filters live, recent and failed runs against the injected clock", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const now = plus(60);
    await call(db, owner, "live", slug, plus(59));
    await call(db, owner, "recent", slug, plus(55));
    await call(db, owner, "old", slug, plus(-60 * 24));
    await call(db, owner, "bad", slug, plus(-60 * 24 * 2), undefined, { ok: false, status: 500, error: "boom" });
    await call(db, owner, "elsewhere", "other-project", plus(59));
    const keys = async (state?: "live" | "recent" | "failed") =>
      (await listProjectRuns(db, owner, slug, { state }, now)).map((r) => [r.live, r.errorCount]);
    expect(await keys("live")).toEqual([[true, 0]]);
    expect(await keys("recent")).toEqual([
      [true, 0],
      [false, 0],
    ]);
    expect(await keys("failed")).toEqual([[false, 1]]);
    expect(await keys()).toHaveLength(4);
    expect(await listProjectRuns(db, owner, slug, { limit: 1 }, now)).toHaveLength(1);
  });

  it("counts calls and errors of this project only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await call(db, owner, "K", slug, plus(0));
    await call(db, owner, "K", slug, plus(1));
    await call(db, owner, "K", "other-project", plus(2), undefined, { ok: false, status: 500, error: "boom" });
    const now = plus(3);
    expect(await listProjectRuns(db, owner, slug, { state: "failed" }, now)).toEqual([]);
    const [run] = await listProjectRuns(db, owner, slug, {}, now);
    expect(run).toMatchObject({ callCount: 2, errorCount: 0 });
  });

  it("returns names, tokens and refuses non-members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const { runId } = await startRun(db, owner, "K", { title: "Fix login", clientSessionId: "s1" });
    await recordUsage(db, owner, "K", usage("s1", 1));
    await recordCall(db, rec(owner, "K", { at: new Date(), input: { project: slug } }));
    const [run] = await listProjectRuns(db, owner, slug, {});
    expect(run).toMatchObject({ id: runId, title: "Fix login", userName: "Owner", callCount: 1, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } });
    const stranger = await insertUser(db);
    await expect(listProjectRuns(db, stranger, slug, {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getRun", () => {
  it("returns the run's calls in this project and only the changes inside its window", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await call(db, owner, "K", slug, plus(0), "a");
    await call(db, owner, "K", slug, plus(1), "a");
    await call(db, owner, "K", "other-project", plus(2));
    const [{ id: runId }] = await runsOf(db, "K");
    const row = (at: Date, over: Partial<typeof changeLog.$inferInsert> = {}) => ({
      projectId,
      entity: "system",
      entityId: "x",
      field: "notes",
      authorUserId: owner.userId,
      agent: "Claude Code",
      createdAt: at,
      ...over,
    });
    const inside = new Date(plus(1).getTime() + 3000);
    await db.insert(changeLog).values([
      row(plus(0.5), { field: "inside" }),
      row(inside, { field: "grace" }),
      row(new Date(plus(2).getTime() + 6000), { field: "late" }),
      row(plus(-1), { field: "early" }),
      row(plus(0.5), { field: "human", agent: null }),
      row(plus(0.5), { field: "other-user", authorUserId: (await insertUser(db)).userId }),
    ]);
    const { run, calls, changes } = await getRun(db, owner, slug, runId);
    expect(run.id).toBe(runId);
    expect(calls).toHaveLength(2);
    expect(changes.map((c) => c.field)).toEqual(["inside", "grace"]);
  });

  it("is not found for a run without calls in the project", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await call(db, owner, "K", "other-project", plus(0));
    const [{ id }] = await runsOf(db, "K");
    await expect(getRun(db, owner, slug, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("systemAgentCost", () => {
  it("shares a run's tokens by its calls per system, leaving out runs without tokens", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    for (const [i, system] of ["a", "a", "a", "b"].entries()) await call(db, owner, "K", slug, plus(i), system);
    await db.update(agentRun).set({ inputTokens: 100, outputTokens: 200, cacheWriteTokens: 700, cacheReadTokens: 5_000_000 }).where(eq(agentRun.apiKeyId, "K"));
    await call(db, owner, "N", slug, plus(0), "a");
    expect(await systemAgentCost(db, owner, slug, "a")).toEqual({ runs: 1, tokens: 750 });
    expect(await systemAgentCost(db, owner, slug, "b")).toEqual({ runs: 1, tokens: 250 });
    await createSystem(db, owner, slug, { slug: "c", title: "C" });
    expect(await systemAgentCost(db, owner, slug, "c")).toBeNull();
  });
});
