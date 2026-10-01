import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/types";
import { ApiKeyRateLimitedError } from "@/lib/auth/rate-limit";
import type { Actor } from "@/lib/ops/actor";
import type { CallRecord } from "@/lib/ops/agent-runs";
import { writeSpec } from "@/lib/ops/documents";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { coerceQuery, handleRest } from "./rest";

/** Resolves every request to `actor` through API key `key-1`. */
const auth = (actor: Actor) => async () => ({ actor, apiKeyId: "key-1" });

/** Sends a REST request through the handler as `actor` (or unauthenticated), reporting calls to `recordCall`. */
async function send(db: Db, actor: Actor | null, method: string, path: string, body?: unknown, recordCall?: (r: CallRecord) => void) {
  const request = new Request(`http://test/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const segments = new URL(request.url).pathname.replace(/^\/api\/v1\//, "").split("/");
  const response = await handleRest(request, segments, { db, resolveAuth: actor ? auth(actor) : async () => null, recordCall });
  return { status: response.status, json: await response.json() };
}

describe("coerceQuery", () => {
  it("turns true and false into booleans only for boolean inputs", () => {
    const shape = { resolved: z.boolean().optional(), system: z.string().optional() };
    expect(coerceQuery(shape, new URLSearchParams("resolved=false&system=true"))).toEqual({ resolved: false, system: "true" });
  });
});

describe("REST", () => {
  it("rejects unknown query parameters with 400", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const result = await send(db, owner, "GET", `/projects/${slug}/questions?resolve=true`);
    expect(result.status).toBe(400);
    expect(result.json.error).toContain('Unknown query parameter "resolve"');
    expect(result.json.error).toContain("resolved");
  });

  it("answers a missing document with a null document", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await send(db, owner, "POST", `/projects/${slug}/systems`, { slug: "s", title: "S" });
    expect(await send(db, owner, "GET", `/projects/${slug}/systems/s/documents/spec`)).toEqual({ status: 200, json: { document: null } });
  });

  it("answers a failing key check with a JSON 500", async () => {
    const db = await createTestDb();
    const request = new Request("http://test/api/v1/projects", { method: "GET" });
    const response = await handleRest(request, ["projects"], {
      db,
      resolveAuth: async () => {
        throw new Error("db down");
      },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong." });
  });

  it("serves reads and writes with the documented status codes", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    expect((await send(db, owner, "GET", "/projects")).json.map((p: { slug: string }) => p.slug)).toEqual([slug]);
    expect((await send(db, owner, "POST", `/projects/${slug}/systems`, { slug: "s", title: "S" })).status).toBe(200);
    expect((await send(db, owner, "POST", `/projects/${slug}/systems`, { title: "no slug" })).status).toBe(400);
    const gate = await send(db, owner, "POST", `/projects/${slug}/systems/s/move`, { column: "Todo" });
    expect(gate.status).toBe(409);
    expect(gate.json.error).toContain("still in planning");
    expect((await send(db, owner, "GET", `/projects/${slug}/questions?resolved=false`)).status).toBe(200);
    expect((await send(db, owner, "GET", `/projects/${slug}/updates?limit=5`)).status).toBe(200);
  });

  it("validates the document version query", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await send(db, owner, "POST", `/projects/${slug}/systems`, { slug: "s", title: "S" });
    await writeSpec(db, owner, slug, "s", { body: "# v1" });
    expect((await send(db, owner, "GET", `/projects/${slug}/systems/s/documents/spec?version=abc`)).status).toBe(400);
    expect((await send(db, owner, "GET", `/projects/${slug}/systems/s/documents/spec?version=1`)).status).toBe(200);
  });

  it("accepts boolean query values for GET tools", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const resolved = await send(db, owner, "GET", `/projects/${slug}/questions?resolved=true`);
    expect(resolved.status).toBe(200);
    expect(Array.isArray(resolved.json)).toBe(true);
  });

  it("lets path parameters win over body fields", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const created = await send(db, owner, "POST", `/projects/${slug}/systems`, { slug: "s", title: "S", project: other.slug });
    expect(created.status).toBe(200);
    const inPath = await send(db, owner, "GET", `/projects/${slug}/systems`);
    expect(inPath.json.map((s: { slug: string }) => s.slug)).toEqual(["s"]);
    const inOther = await send(db, other.owner, "GET", `/projects/${other.slug}/systems`);
    expect(inOther.json).toEqual([]);
  });

  it("rejects ids beyond the integer range with 400", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    expect((await send(db, owner, "GET", `/projects/${slug}/adrs/2147483648`)).status).toBe(400);
    expect((await send(db, owner, "GET", `/projects/${slug}/adrs/99999999999999`)).status).toBe(400);
    expect((await send(db, owner, "GET", `/projects/${slug}/adrs/2147483647`)).status).toBe(404);
  });

  it("rejects malformed and non-object bodies with 400", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    for (const raw of ["{not json", "[1,2]", "null", '"text"']) {
      const request = new Request(`http://test/api/v1/projects/${slug}/systems`, { method: "POST", body: raw });
      const response = await handleRest(request, ["projects", slug, "systems"], { db, resolveAuth: auth(owner) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Request body must be a JSON object." });
    }
    const blank = new Request(`http://test/api/v1/projects/${slug}/systems`, { method: "POST", body: "  " });
    const response = await handleRest(blank, ["projects", slug, "systems"], { db, resolveAuth: auth(owner) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).not.toContain("JSON object");
  });

  it("rejects missing keys, unknown routes and invisible projects", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = (await createProjectFixture(db, "other")).owner;
    expect((await send(db, null, "GET", "/projects")).status).toBe(401);
    expect((await send(db, stranger, "GET", "/nope")).status).toBe(404);
    const hidden = await send(db, stranger, "GET", `/projects/${slug}/systems`);
    expect(hidden).toEqual({ status: 404, json: { error: `Unknown project ${slug}.` } });
  });

  it("coerces numeric path parameters and reports a missing id as required", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await send(db, owner, "POST", `/projects/${slug}/systems`, { slug: "s", title: "S" });
    const added = await send(db, owner, "POST", `/projects/${slug}/systems/s/tasks`, { tasks: [{ title: "First", clientRef: "step-1" }] });
    expect(added.status).toBe(200);
    const [task] = added.json.tasks;
    const renamed = await send(db, owner, "PATCH", `/tasks/${task.id}`, { title: "Renamed" });
    expect(renamed.status).toBe(200);
    const batch = await send(db, owner, "PATCH", "/tasks", { updates: [{ id: task.id, notes: "n" }] });
    expect(batch.status).toBe(200);
    const system = await send(db, owner, "GET", `/projects/${slug}/systems/s`);
    expect(system.json.tasks.map((t: { title: string }) => t.title)).toEqual(["Renamed"]);
    expect((await send(db, owner, "PATCH", "/tasks/abc", { title: "x" })).json.error).toContain("expected number");
  });

  it("answers a rate-limited key with 429 and Retry-After", async () => {
    const db = await createTestDb();
    const request = new Request("http://test/api/v1/projects", { method: "GET" });
    const response = await handleRest(request, ["projects"], {
      db,
      resolveAuth: async () => {
        throw new ApiKeyRateLimitedError(42);
      },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({
      error: "API key rate limit exceeded: at most 600 requests per minute. Retry in 42 s.",
    });
  });
});

describe("REST call recording", () => {
  it("reports each call to the recorder", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const records: CallRecord[] = [];
    expect((await send(db, owner, "GET", `/projects/${slug}/systems`, undefined, (r) => records.push(r))).status).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ apiKeyId: "key-1", userId: owner.userId, tool: "list_systems", transport: "rest", ok: true, status: 200, error: null });
    expect(records[0].input).toEqual({ project: slug });
    expect(typeof records[0].durationMs).toBe("number");
  });

  it("records a failing call with its status", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const records: CallRecord[] = [];
    expect((await send(db, owner, "POST", `/projects/${slug}/systems`, { title: "no slug" }, (r) => records.push(r))).status).toBe(400);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tool: "create_system", ok: false, status: 400 });
    expect(records[0].error).toBeTruthy();
  });

  it("answers unchanged when the recorder throws", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await send(db, owner, "GET", `/projects/${slug}/systems`, undefined, () => {
      throw new Error("recorder down");
    });
    expect(result).toEqual({ status: 200, json: [] });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("starts runs only with a key and does not record the run tools", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    const records: CallRecord[] = [];
    expect((await send(db, null, "POST", "/agent-runs", { title: "Fix" })).status).toBe(401);
    const started = await send(db, owner, "POST", "/agent-runs", { title: "Fix", clientSessionId: "sess-1" }, (r) => records.push(r));
    expect(started.status).toBe(200);
    expect(typeof started.json.runId).toBe("string");
    const usage = { clientSessionId: "sess-1", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect((await send(db, owner, "POST", "/agent-runs/usage", usage, (r) => records.push(r))).status).toBe(200);
    expect(records).toEqual([]);
  });
});
