import { getDb } from "@/db/client";
import { handleWebhook } from "@/lib/github/webhook";
import { bullQueue, QUEUE } from "@/lib/queue";

/** Every delivery must be verified and recorded. */
export const dynamic = "force-dynamic";

/** Receives the deliveries of a repository's manual webhook; the repo id is the path segment. */
export async function POST(request: Request, ctx: { params: Promise<{ repoId: string }> }): Promise<Response> {
  const { repoId } = await ctx.params;
  return handleWebhook({ db: getDb(), queue: bullQueue(QUEUE.github), now: () => new Date() }, request, {
    source: "repo",
    repoId,
  });
}

/** Only POST is accepted. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
