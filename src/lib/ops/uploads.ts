import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { eventFallback, eventRequest, eventSettings, eventUpload, UPLOAD_PURPOSES, type EventUploadRow, type UploadPurpose } from "@/db/schema";
import type { Db, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { displayName, IMAGE_EXTENSIONS, safePath, sniffImage, uploadsDir, UPLOAD_LIMITS } from "@/lib/uploads";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { eventFlags, requestAccess, requireEventManager } from "./request-access";
import { logRequest } from "./requests";

/** An upload as clients see it; `url` serves the bytes behind the access check. */
export interface UploadView {
  id: string;
  requestId: string | null;
  purpose: UploadPurpose;
  originalName: string;
  mime: string;
  bytes: number;
  url: string;
}

/** The serving URL of an upload. */
export const uploadUrl = (id: string): string => `/api/uploads/${id}`;

/** Returns `row` as an {@link UploadView}. */
function toView(row: EventUploadRow): UploadView {
  return { id: row.id, requestId: row.requestId, purpose: row.purpose, originalName: row.originalName, mime: row.mime, bytes: row.bytes, url: uploadUrl(row.id) };
}

/** Input of {@link storeUpload}, apart from the bytes. */
export const storeUploadInput = z.object({
  requestId: z.string().min(1).max(64).nullable(),
  purpose: z.enum(UPLOAD_PURPOSES),
  name: z.string().max(1000),
});

/**
 * Places that hold an upload id and so block its deletion; each returns whether it still uses `uploadId`.
 * Later tasks add their check here.
 */
export const UPLOAD_REFERENCES: ((tx: Tx, uploadId: string) => Promise<boolean>)[] = [
  // A fallback scenario that shows the image. Listed here, not registered by its module, so the guard never depends on import order.
  async (tx, uploadId) => (await tx.select({ id: eventFallback.id }).from(eventFallback).where(eq(eventFallback.imageUploadId, uploadId)).limit(1)).length > 0,
  // The disaster or resolved template of the event settings shows the image.
  async (tx, uploadId) =>
    (
      await tx
        .select({ id: eventSettings.id })
        .from(eventSettings)
        .where(or(sql`${eventSettings.disasterTemplate}->>'imageUploadId' = ${uploadId}`, sql`${eventSettings.resolvedTemplate}->>'imageUploadId' = ${uploadId}`))
        .limit(1)
    ).length > 0,
];

/** Whether the error says the file does not exist. */
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/**
 * Stores an image: checks access, size, the sniffed type and the per-request cap, writes the file without ever
 * overwriting, then inserts the row; the file is removed again when the insert fails. The declared type is ignored.
 * Request uploads need edit access on the request, template uploads (no request) the event manager role.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError, InvalidError (size, type, cap, purpose)
 */
export async function storeUpload(
  db: Db,
  actor: Actor,
  input: { requestId: string | null; purpose: string; name: string; bytes: Uint8Array },
  dir: string = uploadsDir(),
): Promise<UploadView> {
  const { requestId, purpose, name } = storeUploadInput.parse(input);
  if ((purpose === "template") !== (requestId === null)) throw new InvalidError("Settings images use the template purpose and no request; all others belong to a request.");
  return db.transaction(async (tx) => {
    if (requestId === null) requireEventManager(await eventFlags(tx, actor));
    else {
      await requestAccess(tx, actor, requestId, "edit");
      await tx.select({ id: eventRequest.id }).from(eventRequest).where(eq(eventRequest.id, requestId)).for("update");
    }
    if (input.bytes.length === 0) throw new InvalidError("The file is empty.");
    if (input.bytes.length > UPLOAD_LIMITS.maxBytes) throw new InvalidError(`The image may be at most ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MiB.`);
    const mime = sniffImage(input.bytes);
    if (!mime) throw new InvalidError("Only PNG, JPEG, WEBP and GIF images are accepted.");
    if (requestId !== null) {
      const [{ n }] = await tx.select({ n: count() }).from(eventUpload).where(eq(eventUpload.requestId, requestId));
      if (n >= UPLOAD_LIMITS.maxPerRequest) throw new InvalidError(`A request may have at most ${UPLOAD_LIMITS.maxPerRequest} images.`);
    }
    const id = newId();
    const storageKey = `${id}.${IMAGE_EXTENSIONS[mime]}`;
    const file = safePath(dir, storageKey);
    await writeFile(file, input.bytes, { flag: "wx" });
    try {
      const [row] = await tx
        .insert(eventUpload)
        .values({ id, requestId, uploaderId: actor.userId, purpose, originalName: displayName(name), mime, bytes: input.bytes.length, storageKey })
        .returning();
      return toView(row);
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    }
  });
}

/**
 * Loads an upload and checks the actor may act on it with `need`; a request upload follows the request. A template upload
 * (the banner and disaster images) may be viewed by every signed-in user, because requesters see the disaster preview and
 * the images are posted publicly anyway; only event managers change it.
 */
async function accessibleUpload(tx: Tx | Db, actor: Actor, id: string, need: "view" | "edit"): Promise<EventUploadRow> {
  const [row] = await tx.select().from(eventUpload).where(eq(eventUpload.id, id)).limit(1);
  if (!row) throw new NotFoundError(`Unknown upload ${id}.`);
  if (row.requestId) await requestAccess(tx, actor, row.requestId, need);
  else if (need === "edit") requireEventManager(await eventFlags(tx, actor));
  return row;
}

/**
 * Deletes an upload: its row and its file. A banner that points at it is cleared (and logged); another place that
 * still uses it (see {@link UPLOAD_REFERENCES}) refuses the deletion.
 *
 * @throws NotFoundError, ForbiddenError, ConflictError when the image is still used
 */
export async function deleteUpload(db: Db, actor: Actor, id: string, dir: string = uploadsDir()): Promise<void> {
  const row = await db.transaction(async (tx) => {
    const upload = await accessibleUpload(tx, actor, id, "edit");
    for (const used of UPLOAD_REFERENCES) {
      if (await used(tx, id)) throw new ConflictError("This image is still used by another part of the event. Remove it there first.");
    }
    if (upload.requestId) {
      const cleared = await tx
        .update(eventRequest)
        .set({ bannerUploadId: null })
        .where(and(eq(eventRequest.id, upload.requestId), eq(eventRequest.bannerUploadId, id)))
        .returning({ id: eventRequest.id });
      if (cleared.length) await logRequest(tx, actor, { requestId: upload.requestId, field: "banner", oldValue: upload.originalName, newValue: null });
    }
    await tx.delete(eventUpload).where(eq(eventUpload.id, id));
    return upload;
  });
  await rm(safePath(dir, row.storageKey), { force: true });
}

/** An upload opened for serving. */
export interface OpenedUpload {
  stream: ReadableStream;
  mime: string;
  bytes: number;
  name: string;
}

/**
 * Opens an upload for reading after the access check: request uploads follow view access on the request, template
 * uploads are visible to event managers, admins and developers.
 *
 * @throws NotFoundError for an unknown upload, no access or a missing file
 */
export async function openUpload(db: Db, actor: Actor, id: string, dir: string = uploadsDir()): Promise<OpenedUpload> {
  const row = await accessibleUpload(db, actor, id, "view");
  const file = safePath(dir, row.storageKey);
  const info = await stat(file).catch((error: unknown) => {
    if (isMissing(error)) throw new NotFoundError(`Unknown upload ${id}.`);
    throw error;
  });
  return { stream: Readable.toWeb(createReadStream(file)) as ReadableStream, mime: row.mime, bytes: info.size, name: row.originalName };
}

/**
 * Reads an upload for a worker job; there is no actor, so only jobs call this.
 *
 * @throws NotFoundError for an unknown upload or a missing file
 */
export async function readUploadForWorker(db: Db, uploadId: string, dir: string = uploadsDir()): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const [row] = await db.select().from(eventUpload).where(eq(eventUpload.id, uploadId)).limit(1);
  if (!row) throw new NotFoundError(`Unknown upload ${uploadId}.`);
  const bytes = await readFile(safePath(dir, row.storageKey)).catch((error: unknown) => {
    if (isMissing(error)) throw new NotFoundError(`The file of upload ${uploadId} is missing.`);
    throw error;
  });
  return { bytes, mime: row.mime, name: row.originalName };
}

/** How old a file without a row must be before it is removed. */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** The shape of a generated storage key; other files in the directory are left alone. */
const STORAGE_KEY = /^[0-9a-f-]+\.(png|jpg|webp|gif)$/;

/**
 * Removes files in `dir` that no row refers to and that are older than a day (left behind by a failed request or a
 * deleted request); a fresh file may belong to an upload that is still being saved. Returns how many it removed.
 */
export async function sweepOrphanFiles(db: Db, dir: string = uploadsDir(), now: Date = new Date()): Promise<number> {
  const names = (await readdir(dir)).filter((n) => STORAGE_KEY.test(n));
  let removed = 0;
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const known = new Set((await db.select({ key: eventUpload.storageKey }).from(eventUpload).where(inArray(eventUpload.storageKey, chunk))).map((r) => r.key));
    for (const name of chunk) {
      if (known.has(name)) continue;
      const file = safePath(dir, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || now.getTime() - info.mtimeMs < ORPHAN_AGE_MS) continue;
      await rm(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/** Input of {@link setBanner}. */
export const setBannerInput = z.object({ requestId: z.string().min(1).max(64), uploadId: z.string().min(1).max(64).nullable() });

/**
 * Sets or clears the banner of a request (edit access) and logs it as `banner`. The image must be a banner upload of the same request.
 *
 * @throws NotFoundError, ForbiddenError, InvalidError for another request's or purpose's image
 */
export async function setBanner(db: Db, actor: Actor, raw: unknown): Promise<void> {
  const { requestId, uploadId } = setBannerInput.parse(raw);
  await db.transaction(async (tx) => {
    const { request } = await requestAccess(tx, actor, requestId, "edit");
    if (request.bannerUploadId === uploadId) return;
    let name: string | null = null;
    if (uploadId) {
      const [upload] = await tx.select().from(eventUpload).where(eq(eventUpload.id, uploadId)).limit(1);
      if (!upload || upload.requestId !== requestId) throw new InvalidError("Unknown image for this request.");
      if (upload.purpose !== "banner") throw new InvalidError("This image was not uploaded as a banner.");
      name = upload.originalName;
    }
    await tx.update(eventRequest).set({ bannerUploadId: uploadId }).where(eq(eventRequest.id, requestId));
    await logRequest(tx, actor, { requestId, field: "banner", oldValue: request.bannerUploadId ? "set" : null, newValue: name });
  });
}

/**
 * Makes sure the uploads directory exists and can be written; the worker calls it at start.
 *
 * @throws Error naming `EVENT_UPLOADS_DIR` when it cannot
 */
export async function checkUploadsDir(dir: string): Promise<void> {
  const probe = path.join(dir, `.write-check-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true });
  } catch (error) {
    throw new Error(`EVENT_UPLOADS_DIR (${dir}) is not a writable directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}
