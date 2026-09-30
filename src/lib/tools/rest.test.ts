import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { coerceQuery, handleRest } from "./rest";

/** Sends a REST request through the handler as `actor` (or unauthenticated). */
async function send(db: Db, actor: Actor | null, method: string, path: string, body?: unknown) {
  const request = new Request(`http://test/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const segments = new URL(request.url).pathname.replace(/^\/api\/v1\//, "").split("/");
  const response = await handleRest(request, segments, { db, resolveActor: async () => actor });
  return { status: response.status, json: await response.json() };
}

describe("coerceQuery", () => {
  it("turns true and false into booleans only for boolean inputs", () => {
    const shape = { resolved: z.boolean().optional(), system: z.string().optional() };
    expect(coerceQuery(shape, new URLSearchParams("resolved=false&system=true"))).toEqual({ resolved: false, system: "true" });
  });
});

describe("REST", () => {
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

  it("rejects malformed and non-object bodies with 400", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    for (const raw of ["{not json", "[1,2]", "null", '"text"']) {
      const request = new Request(`http://test/api/v1/projects/${slug}/systems`, { method: "POST", body: raw });
      const response = await handleRest(request, ["projects", slug, "systems"], { db, resolveActor: async () => owner });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Request body must be a JSON object." });
    }
    const blank = new Request(`http://test/api/v1/projects/${slug}/systems`, { method: "POST", body: "  " });
    const response = await handleRest(blank, ["projects", slug, "systems"], { db, resolveActor: async () => owner });
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
});
