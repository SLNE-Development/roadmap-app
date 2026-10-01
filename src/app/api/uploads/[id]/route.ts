import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { OpError } from "@/lib/ops/errors";
import { openUpload } from "@/lib/ops/uploads";

/** Reads the session and the database on every call. */
export const dynamic = "force-dynamic";

/** Encodes a file name for `filename*=UTF-8''…`: everything but unreserved characters is percent-encoded. */
const encodeName = (name: string): string => encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Streams an uploaded image. The type comes from the row and is never sniffed again; `nosniff` keeps browsers to it.
 * Responds 401 without a session and 404 for an unknown upload and for no access alike.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await sessionActor();
  if (!actor) return Response.json({ error: "Sign in to see images." }, { status: 401 });
  const { id } = await params;
  try {
    const file = await openUpload(getDb(), actor, id);
    return new Response(file.stream, {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeName(file.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof OpError) return Response.json({ error: "Unknown image." }, { status: 404 });
    console.error(error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
