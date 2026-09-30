import { getDb } from "@/db/client";
import { bearerActor } from "@/lib/auth/actor";
import { handleRest } from "@/lib/tools/rest";

/** Every REST request reads live data. */
export const dynamic = "force-dynamic";

/** Route context with the catch-all path segments. */
interface Context {
  params: Promise<{ path: string[] }>;
}

/** Dispatches a REST request to the tool registry. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return handleRest(request, path, { db: getDb(), resolveActor: bearerActor });
}

/** REST reads. */
export const GET = handle;

/** REST creates and actions. */
export const POST = handle;

/** REST partial updates. */
export const PATCH = handle;

/** REST replacements. */
export const PUT = handle;

/** REST deletions. */
export const DELETE = handle;
