import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventFallback, eventRequest, eventUpload, requestLog } from "@/db/schema";
import type { Db } from "@/db/types";
import { newId } from "@/lib/id";
import { UPLOAD_LIMITS } from "@/lib/uploads";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { checkUploadsDir, deleteUpload, openUpload, readUploadForWorker, setBanner, storeUpload, sweepOrphanFiles, UPLOAD_REFERENCES } from "./uploads";

const png = (size = 64) => Uint8Array.from({ length: size }, (_, i) => (i < 4 ? [0x89, 0x50, 0x4e, 0x47][i] : i));
const gif = () => new TextEncoder().encode("GIF89a\x01\x00\x01\x00");

let db: Db;
let dir: string;
let requester: Actor;
let stranger: Actor;
let manager: Actor;
let requestId: string;

beforeEach(async () => {
  db = await createTestDb();
  dir = await mkdtemp(path.join(os.tmpdir(), "uploads-"));
  requester = await insertUser(db, { name: "Requester" });
  stranger = await insertUser(db, { name: "Stranger" });
  manager = await insertUser(db, { name: "Manager", isEventManager: true });
  requestId = (await requestFixture(db, requester)).id;
});

const BUILT_IN_REFERENCES = [...UPLOAD_REFERENCES];

afterEach(async () => {
  UPLOAD_REFERENCES.splice(0, UPLOAD_REFERENCES.length, ...BUILT_IN_REFERENCES);
  await rm(dir, { recursive: true, force: true });
});

const store = (over: Partial<Parameters<typeof storeUpload>[2]> = {}, actor = requester) =>
  storeUpload(db, actor, { requestId, purpose: "banner", name: "a.png", bytes: png(), ...over }, dir);

describe("storeUpload", () => {
  it("stores the file and the row, and returns a serving url", async () => {
    const view = await store({ name: "../../my pic.png" });
    expect(view).toMatchObject({ requestId, purpose: "banner", originalName: "my pic.png", mime: "image/png", bytes: 64, url: `/api/uploads/${view.id}` });
    expect(await readdir(dir)).toEqual([`${view.id}.png`]);
  });

  it("rejects a 9 MiB buffer", async () => {
    await expect(store({ bytes: png(9 * 1024 * 1024) })).rejects.toBeInstanceOf(InvalidError);
    expect(await readdir(dir)).toEqual([]);
  });

  it("trusts the sniffed type, not the name: a GIF named .png is stored as image/gif", async () => {
    const view = await store({ bytes: gif() });
    expect(view.mime).toBe("image/gif");
    expect(await readdir(dir)).toEqual([`${view.id}.gif`]);
  });

  it("rejects non-image bytes and leaves no file or row", async () => {
    await expect(store({ bytes: new TextEncoder().encode("<html></html>") })).rejects.toBeInstanceOf(InvalidError);
    expect(await readdir(dir)).toEqual([]);
    expect(await db.select().from(eventUpload)).toEqual([]);
  });

  it("hides the request from a stranger", async () => {
    await expect(store({}, stranger)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses the 41st upload of a request", async () => {
    const rows = Array.from({ length: UPLOAD_LIMITS.maxPerRequest }, () => {
      const id = newId();
      return { id, requestId, purpose: "embed" as const, originalName: "x.png", mime: "image/png", bytes: 1, storageKey: `${id}.png` };
    });
    await db.insert(eventUpload).values(rows);
    await expect(store({ purpose: "embed" })).rejects.toBeInstanceOf(InvalidError);
  });

  it("removes the file when the insert fails", async () => {
    const failing = {
      ...db,
      transaction: (run: (tx: unknown) => Promise<unknown>) =>
        db.transaction((tx) =>
          run(
            new Proxy(tx, {
              get(target, prop) {
                if (prop === "insert") return () => ({ values: () => ({ returning: () => Promise.reject(new Error("insert failed")) }) });
                const value = Reflect.get(target, prop, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        ),
    } as unknown as Db;
    await expect(storeUpload(failing, requester, { requestId, purpose: "banner", name: "a.png", bytes: png() }, dir)).rejects.toThrow("insert failed");
    expect(await readdir(dir)).toEqual([]);
  });

  it("checks the purpose against the request", async () => {
    await expect(store({ purpose: "template" })).rejects.toBeInstanceOf(InvalidError);
    await expect(store({ requestId: null, purpose: "banner" })).rejects.toBeInstanceOf(InvalidError);
  });

  it("lets only event managers and admins store template images", async () => {
    await expect(store({ requestId: null, purpose: "template" }, requester)).rejects.toBeInstanceOf(ForbiddenError);
    const view = await store({ requestId: null, purpose: "template" }, manager);
    expect(view.requestId).toBeNull();
  });
});

describe("openUpload", () => {
  it("hides the image from a stranger and serves it to the requester", async () => {
    const view = await store();
    await expect(openUpload(db, stranger, view.id, dir)).rejects.toBeInstanceOf(NotFoundError);
    const opened = await openUpload(db, requester, view.id, dir);
    expect(opened).toMatchObject({ mime: "image/png", bytes: 64, name: "a.png" });
    expect(new Uint8Array(await new Response(opened.stream).arrayBuffer())).toEqual(png());
  });

  it("shows template images to every signed-in user (the disaster preview needs them), but only event managers change them", async () => {
    const view = await store({ requestId: null, purpose: "template" }, manager);
    await expect(openUpload(db, manager, view.id, dir)).resolves.toBeDefined();
    await expect(openUpload(db, requester, view.id, dir)).resolves.toBeDefined();
    await expect(deleteUpload(db, requester, view.id, dir)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("says not found for an unknown id", async () => {
    await expect(openUpload(db, requester, "nope", dir)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("readUploadForWorker", () => {
  it("returns bytes, type and name without an actor", async () => {
    const view = await store();
    expect(await readUploadForWorker(db, view.id, dir)).toMatchObject({ mime: "image/png", name: "a.png" });
    await expect(readUploadForWorker(db, "nope", dir)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteUpload", () => {
  it("removes row and file and clears the banner", async () => {
    const view = await store();
    await setBanner(db, requester, { requestId, uploadId: view.id });
    await deleteUpload(db, requester, view.id, dir);
    expect(await db.select().from(eventUpload)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
    const [row] = await db.select().from(eventRequest).where(eq(eventRequest.id, requestId));
    expect(row.bannerUploadId).toBeNull();
  });

  it("refuses with a Conflict while a registered reference uses the image", async () => {
    const view = await store();
    UPLOAD_REFERENCES.push(async () => true);
    await expect(deleteUpload(db, requester, view.id, dir)).rejects.toBeInstanceOf(ConflictError);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("refuses while a fallback scenario shows the image, without importing the fallback ops", async () => {
    const view = await store({ purpose: "fallback" });
    await db.update(eventFallback).set({ imageUploadId: view.id }).where(eq(eventFallback.key, "server-down"));
    await expect(deleteUpload(db, requester, view.id, dir)).rejects.toBeInstanceOf(ConflictError);
  });

  it("needs edit access", async () => {
    const view = await store();
    await expect(deleteUpload(db, stranger, view.id, dir)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("setBanner", () => {
  it("sets, clears and logs the banner", async () => {
    const view = await store();
    await setBanner(db, requester, { requestId, uploadId: view.id });
    expect((await db.select().from(eventRequest).where(eq(eventRequest.id, requestId)))[0].bannerUploadId).toBe(view.id);
    await setBanner(db, requester, { requestId, uploadId: null });
    expect((await db.select().from(eventRequest).where(eq(eventRequest.id, requestId)))[0].bannerUploadId).toBeNull();
    const log = await db.select().from(requestLog).where(eq(requestLog.field, "banner"));
    expect(log).toHaveLength(2);
  });

  it("refuses another request's image or another purpose", async () => {
    const other = (await requestFixture(db, requester)).id;
    const foreign = await storeUpload(db, requester, { requestId: other, purpose: "banner", name: "b.png", bytes: png() }, dir);
    await expect(setBanner(db, requester, { requestId, uploadId: foreign.id })).rejects.toBeInstanceOf(InvalidError);
    const embed = await store({ purpose: "embed" });
    await expect(setBanner(db, requester, { requestId, uploadId: embed.id })).rejects.toBeInstanceOf(InvalidError);
  });

  it("hides the request from a stranger", async () => {
    await expect(setBanner(db, stranger, { requestId, uploadId: null })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("sweepOrphanFiles", () => {
  it("keeps referenced and fresh files and removes old orphans, including those of a deleted request", async () => {
    await store();
    await store({ name: "b.png" });
    await db.delete(eventRequest).where(eq(eventRequest.id, requestId));
    expect(await db.select().from(eventUpload)).toEqual([]);
    expect(await readdir(dir)).toHaveLength(2);

    const second = (await requestFixture(db, requester)).id;
    const live = await storeUpload(db, requester, { requestId: second, purpose: "banner", name: "c.png", bytes: png() }, dir);
    const fresh = `${newId()}.png`;
    await writeFile(path.join(dir, fresh), png());
    const old = `${newId()}.png`;
    await writeFile(path.join(dir, old), png());
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(path.join(dir, old), longAgo, longAgo);
    await writeFile(path.join(dir, "notes.txt"), "keep");

    // The two files of the deleted request were just written; the sweep runs two days later, the fresh file was written "now".
    const now = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await utimes(path.join(dir, fresh), now, now);
    await utimes(path.join(dir, `${live.id}.png`), longAgo, longAgo);

    expect(await sweepOrphanFiles(db, dir, now)).toBe(3);
    expect((await readdir(dir)).sort()).toEqual([fresh, `${live.id}.png`, "notes.txt"].sort());
  });
});

describe("checkUploadsDir", () => {
  it("creates a missing directory and leaves no probe file", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "uploads-check-"));
    const dir = path.join(base, "nested", "uploads");
    await checkUploadsDir(dir);
    expect(await readdir(dir)).toEqual([]);
    await rm(base, { recursive: true, force: true });
  });

  it("names EVENT_UPLOADS_DIR when the path is a file", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "uploads-check-"));
    const file = path.join(base, "file");
    await writeFile(file, "x");
    await expect(checkUploadsDir(file)).rejects.toThrow("EVENT_UPLOADS_DIR");
    await rm(base, { recursive: true, force: true });
  });
});
