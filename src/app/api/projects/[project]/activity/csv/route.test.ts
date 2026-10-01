import { describe, expect, it, vi } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { logChange } from "@/lib/ops/log";
import { createSystem } from "@/lib/ops/systems";
import { withAgent } from "@/lib/ops/actor";
import { handleActivityCsv } from "./route";

vi.mock("@/lib/auth/actor", () => ({ sessionActor: async () => null, bearerActor: async () => null }));
vi.mock("@/db/client", () => ({ getDb: () => null }));

/** Calls the handler for `slug` with the query string `qs`. */
function call(deps: Parameters<typeof handleActivityCsv>[1], slug: string, qs = ""): Promise<Response> {
  return handleActivityCsv(new Request(`http://test/api/projects/${slug}/activity/csv${qs}`), deps, slug);
}

describe("handleActivityCsv", () => {
  it("streams every change as CSV in id-descending order, paging by 500", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const existing = (await db.select({ id: changeLog.id }).from(changeLog)).length;
    for (let i = 0; i < 1203 - existing; i += 1) {
      await logChange(db, owner, { projectId, entity: "task", entityId: i, field: "title", oldValue: null, newValue: i === 0 ? "=SUM(1)" : `t${i}` });
    }
    const response = await call({ db, actor: viewer }, slug);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="demo-activity-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await response.text()).split("\r\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(1204);
    expect(lines[0]).toBe("id,created_at,author,agent,entity,entity_id,system,field,old_value,new_value");
    const ids = lines.slice(1).map((l) => Number(l.split(",")[0]));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(1203);
    expect(lines.some((l) => l.endsWith(",title,,'=SUM(1)"))).toBe(true);
  });

  it("names the system slug, the person and the agent", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, withAgent(owner, "Claude Code"), slug, { slug: "alpha", title: "Alpha" });
    const text = await (await call({ db, actor: owner }, slug)).text();
    expect(text).toContain(",Owner,Claude Code,system,");
    expect(text).toContain(",alpha,created,");
  });

  it("exports only the requested groups", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await logChange(db, owner, { projectId, entity: "task", entityId: 1, field: "title" });
    await logChange(db, owner, { projectId, entity: "adr", entityId: 1, field: "title" });
    const rows = (await (await call({ db, actor: owner }, slug, "?groups=tasks")).text()).trim().split("\r\n").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(",task,");
  });

  it("answers a non-member with 404 JSON and a missing actor with 401", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = await insertUser(db);
    const notFound = await call({ db, actor: stranger }, slug);
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: expect.any(String) });
    const none = await call({ db, actor: null }, slug);
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: expect.any(String) });
  });
});
