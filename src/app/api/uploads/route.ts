import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";
import { storeUpload } from "@/lib/ops/uploads";
import { siteUrl } from "@/lib/site";
import { sniffImage, UPLOAD_LIMITS } from "@/lib/uploads";

/** Reads the session and writes the database and the uploads volume on every call. */
export const dynamic = "force-dynamic";

/** What the multipart framing and the text fields may add to the file itself. */
const FORM_OVERHEAD_BYTES = 16 * 1024;

/**
 * Reads the request body up to `limit` bytes. Returns null as soon as the body is larger, without reading the rest.
 */
async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

/**
 * Whether the browser says the request comes from this site, so another site cannot post a form with the user's cookie.
 * `Sec-Fetch-Site` decides when present; only without it is `Origin` compared to the site URL.
 */
function sameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  return origin === null || origin === siteUrl().origin;
}

/**
 * Stores an image from `multipart/form-data` with the fields `file`, `purpose` and optional `requestId`. Responds 201 with the
 * upload, 401 without a session, 403 for another origin, 413 for a body over the size limit (rejected from `Content-Length`
 * and again while reading), 415 for anything but PNG, JPEG, WEBP or GIF bytes, and 400, 403 or 404 from the operation.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "Only this site may upload images." }, { status: 403 });
  const actor = await sessionActor();
  if (!actor) return Response.json({ error: "Sign in to upload images." }, { status: 401 });
  const tooLarge = () => Response.json({ error: `The image may be at most ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MiB.` }, { status: 413 });
  const limit = UPLOAD_LIMITS.maxBytes + FORM_OVERHEAD_BYTES;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return tooLarge();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return Response.json({ error: "Send the image as multipart/form-data." }, { status: 400 });
  const body = await readLimited(request, limit);
  if (!body) return tooLarge();
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData().catch(() => null);
  const file = form?.get("file");
  const purpose = form?.get("purpose");
  const requestId = form?.get("requestId");
  if (!form || !(file instanceof File) || typeof purpose !== "string") return Response.json({ error: "Send a file and a purpose." }, { status: 400 });
  if (file.size > UPLOAD_LIMITS.maxBytes) return tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(bytes)) return Response.json({ error: "Only PNG, JPEG, WEBP and GIF images are accepted." }, { status: 415 });
  try {
    const view = await storeUpload(getDb(), actor, { requestId: typeof requestId === "string" && requestId ? requestId : null, purpose, name: file.name, bytes });
    return Response.json(view, { status: 201 });
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
}
