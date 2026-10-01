import { getDb } from "@/db/client";
import { handleWebhook } from "@/lib/github/webhook";
import { bullQueue, QUEUE } from "@/lib/queue";

/** Every delivery must be verified and recorded. */
export const dynamic = "force-dynamic";

/** Receives the GitHub App's webhook deliveries. */
export async function POST(request: Request): Promise<Response> {
  return handleWebhook({ db: getDb(), queue: bullQueue(QUEUE.github), now: () => new Date() }, request, { source: "app" });
}

/** Only POST is accepted. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
