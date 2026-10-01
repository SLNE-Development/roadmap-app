import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { GET } from "./[id]/route";
import { POST } from "./route";

/** Stand-ins for the session and the database, so tests choose the signed-in actor. */
const { session, testDb } = vi.hoisted(() => ({ session: { actor: null as unknown }, testDb: { current: null as unknown } }));
vi.mock("@/lib/auth/actor", () => ({ sessionActor: async () => session.actor }));
vi.mock("@/db/client", () => ({ getDb: () => testDb.current }));

let db: Db;
let dir: string;
let requester: Actor;
let stranger: Actor;
let requestId: string;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  dir = await mkdtemp(path.join(os.tmpdir(), "uploads-route-"));
  vi.stubEnv("EVENT_UPLOADS_DIR", dir);
  db = await createTestDb();
  testDb.current = db;
  requester = await insertUser(db, { name: "Requester" });
  stranger = await insertUser(db, { name: "Stranger" });
  requestId = (await requestFixture(db, requester)).id;
  session.actor = requester;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const png = () => Uint8Array.from({ length: 64 }, (_, i) => (i < 4 ? [0x89, 0x50, 0x4e, 0x47][i] : i));

/** Posts a form; a header set to null is left out. */
function post(fields: Record<string, string | File>, headers: Record<string, string | null> = {}): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const all: Record<string, string | null> = { "sec-fetch-site": "same-origin", ...headers };
  return POST(new Request("http://test/api/uploads", { method: "POST", headers: Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => e[1] !== null)), body: form }));
}

const get = (id: string) => GET(new Request(`http://test/api/uploads/${id}`), { params: Promise.resolve({ id }) });

describe("POST /api/uploads", () => {
  it("answers 401 without a session", async () => {
    session.actor = null;
    const res = await post({ file: new File([png()], "a.png"), purpose: "banner", requestId });
    expect(res.status).toBe(401);
  });

  it("answers 403 to a request from another site", async () => {
    const res = await post({ file: new File([png()], "a.png"), purpose: "banner", requestId }, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("stores an image and answers 201 with the view", async () => {
    const res = await post({ file: new File([png()], "a.png", { type: "image/jpeg" }), purpose: "banner", requestId });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { id: string; mime: string; url: string };
    expect(view).toMatchObject({ mime: "image/png", url: `/api/uploads/${view.id}` });
    expect(await readdir(dir)).toEqual([`${view.id}.png`]);
  });

  it("answers 415 for a wrong type, whatever it is called", async () => {
    const res = await post({ file: new File(["<html></html>"], "a.png", { type: "image/png" }), purpose: "banner", requestId });
    expect(res.status).toBe(415);
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers 413 from Content-Length without reading the body", async () => {
    const res = await post({ file: new File([png()], "a.png"), purpose: "banner", requestId }, { "content-length": String(20 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it("answers 413 for a streamed body of unknown length and stops reading", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 200) controller.close();
        else controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const res = await POST(
      new Request("http://test/api/uploads", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "content-type": "multipart/form-data; boundary=x" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  it("answers 404 for a request the actor cannot see", async () => {
    session.actor = stranger;
    const res = await post({ file: new File([png()], "a.png"), purpose: "banner", requestId });
    expect(res.status).toBe(404);
  });

  it("answers 400 without a file", async () => {
    const res = await post({ purpose: "banner", requestId });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/uploads/[id]", () => {
  async function upload(): Promise<string> {
    const res = await post({ file: new File([png()], "my pic (1).png"), purpose: "banner", requestId });
    return ((await res.json()) as { id: string }).id;
  }

  it("streams the file with the stored type and safe headers", async () => {
    const id = await upload();
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(res.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''my%20pic%20%281%29.png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png());
  });

  it("answers 404 to a stranger and for an unknown id", async () => {
    const id = await upload();
    session.actor = stranger;
    expect((await get(id)).status).toBe(404);
    expect((await get("nope")).status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const id = await upload();
    session.actor = null;
    expect((await get(id)).status).toBe(401);
  });
});
