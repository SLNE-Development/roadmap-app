import { describe, expect, it } from "vitest";
import { agentCall, agentRun } from "@/db/schema";
import { memoryKv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createBoard } from "./boards";
import { NotFoundError } from "./errors";
import { boardPresence, heartbeat, systemPresence } from "./presence";
import { createSystem } from "./systems";

async function setup() {
  const db = await createTestDb();
  const kv = memoryKv();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const sys = await createSystem(db, owner, slug, { slug: "api", title: "API" });
  const a = await addMemberFixture(db, owner, slug, "viewer", "Ada");
  const b = await addMemberFixture(db, owner, slug, "viewer", "Ben");
  return { db, kv, owner, slug, projectId, sys, a, b, now: new Date() };
}

const after = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

describe("heartbeat", () => {
  it("reports a change only for a new, stale or left presence", async () => {
    const { db, kv, slug, projectId, a, now } = await setup();
    const input = { project: slug, system: "api" };
    expect(await heartbeat(db, kv, a, input, now)).toEqual({ changed: true, projectId });
    expect((await heartbeat(db, kv, a, input, after(now, 30))).changed).toBe(false);
  });

  it("lists others but not the actor, and drops entries 60 s old", async () => {
    const { db, kv, slug, a, b, now } = await setup();
    const input = { project: slug, system: "api" };
    await heartbeat(db, kv, a, input, now);
    const seen = await systemPresence(db, kv, b, input, after(now, 30));
    expect(seen.people).toEqual([{ userId: a.userId, name: "Ada", at: now.toISOString() }]);
    expect((await systemPresence(db, kv, a, input, after(now, 30))).people).toEqual([]);
    expect((await systemPresence(db, kv, b, input, after(now, 61))).people).toEqual([]);
  });

  it("removes the actor when leaving", async () => {
    const { db, kv, slug, a, b, now } = await setup();
    const input = { project: slug, system: "api" };
    await heartbeat(db, kv, a, input, now);
    expect((await heartbeat(db, kv, a, { ...input, leaving: true }, after(now, 5))).changed).toBe(true);
    expect((await systemPresence(db, kv, b, input, after(now, 6))).people).toEqual([]);
    expect((await heartbeat(db, kv, a, input, after(now, 10))).changed).toBe(true);
  });

  it("hides the project from outsiders", async () => {
    const { db, kv, slug, now } = await setup();
    const outsider = await insertUser(db, { name: "Out" });
    const input = { project: slug, system: "api" };
    await expect(heartbeat(db, kv, outsider, input, now)).rejects.toBeInstanceOf(NotFoundError);
    await expect(systemPresence(db, kv, outsider, input, now)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("agents", () => {
  it("lists recent agent calls once per user and agent", async () => {
    const { db, kv, slug, projectId, a, b, now } = await setup();
    await db.insert(agentRun).values({ id: "r1", apiKeyId: "k1", userId: a.userId });
    const call = (secondsAgo: number, systemSlug = "api") => ({
      runId: "r1", at: after(now, -secondsAgo), tool: "get_system", transport: "mcp" as const, agent: "Claude Code",
      projectId, systemSlug, ok: true, status: 200, durationMs: 1,
    });
    await db.insert(agentCall).values([call(90), call(100), call(180)]);
    const { agents } = await systemPresence(db, kv, b, { project: slug, system: "api" }, now);
    expect(agents).toEqual([{ userId: a.userId, name: "Ada", agent: "Claude Code", at: after(now, -90).toISOString() }]);
  });
});

describe("boardPresence", () => {
  it("returns entries only for systems with someone present", async () => {
    const { db, kv, owner, slug, projectId, a, b, now } = await setup();
    await createBoard(db, owner, slug, { slug: "second", name: "Second" });
    await createSystem(db, owner, slug, { slug: "web", title: "Web" });
    await createSystem(db, owner, slug, { slug: "ui", title: "UI" });
    await heartbeat(db, kv, a, { project: slug, system: "web" }, now);
    await db.insert(agentRun).values({ id: "r2", apiKeyId: "k2", userId: a.userId });
    await db.insert(agentCall).values({
      runId: "r2", at: after(now, -10), tool: "t", transport: "mcp", agent: "Claude Code", projectId, systemSlug: "ui", ok: true, status: 200, durationMs: 1,
    });
    const result = await boardPresence(db, kv, b, { project: slug, board: await defaultBoard(db, projectId) }, after(now, 5));
    expect(Object.keys(result).sort()).toEqual(["ui", "web"]);
    expect(result.web.people.map((p) => p.name)).toEqual(["Ada"]);
    expect(result.ui.agents).toHaveLength(1);
  });
});

async function defaultBoard(db: Awaited<ReturnType<typeof createTestDb>>, projectId: string): Promise<string> {
  const rows = await db.query.board.findMany({ where: (t, { eq }) => eq(t.projectId, projectId) });
  return rows.find((r) => r.slug !== "second")!.slug;
}
