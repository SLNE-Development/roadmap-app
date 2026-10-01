import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import { storeUpload } from "@/lib/ops/uploads";
import { updateEventSettings } from "@/lib/ops/event-settings";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { GET } from "./route";

const { testDb } = vi.hoisted(() => ({ testDb: { current: null as unknown } }));
vi.mock("@/db/client", () => ({ getDb: () => testDb.current }));

let db: Db;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uploads-public-"));
  vi.stubEnv("EVENT_UPLOADS_DIR", dir);
  db = await createTestDb();
  testDb.current = db;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const png = () => Uint8Array.from({ length: 64 }, (_, i) => (i < 4 ? [0x89, 0x50, 0x4e, 0x47][i] : i));
const get = (id: string) => GET(new Request(`http://test/api/uploads/public/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/uploads/public/[id]", () => {
  it("serves only the current avatar, without a session", async () => {
    const manager = await insertUser(db, { name: "Manager", isEventManager: true });
    const avatar = await storeUpload(db, manager, { requestId: null, purpose: "template", name: "a.png", bytes: png() }, dir);
    const other = await storeUpload(db, manager, { requestId: null, purpose: "template", name: "b.png", bytes: png() }, dir);
    expect((await get(avatar.id)).status).toBe(404);
    await updateEventSettings(db, manager, { postAvatarUploadId: avatar.id });
    const res = await get(avatar.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png());
    expect((await get(other.id)).status).toBe(404);
    expect((await get("unknown")).status).toBe(404);
  });
});
