import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentCall, agentRun } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { NotFoundError } from "@/lib/ops/errors";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { callTarget, recordCall, recordUsage, startRun, type CallRecord } from "./agent-runs";

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
