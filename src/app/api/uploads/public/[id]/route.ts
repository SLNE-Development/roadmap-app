import { getDb } from "@/db/client";
import { OpError } from "@/lib/ops/errors";
import { openPublicAvatar } from "@/lib/ops/uploads";

/** Reads the database on every call. */
export const dynamic = "force-dynamic";

/**
 * Streams the webhook sender image without a session, because Discord fetches it. Only the upload the event settings
 * currently use as the avatar is served; every other id answers 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const file = await openPublicAvatar(getDb(), id);
    return new Response(file.stream, {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    if (error instanceof OpError) return Response.json({ error: "Unknown image." }, { status: 404 });
    console.error(error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
