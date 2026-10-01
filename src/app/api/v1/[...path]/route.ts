import { after } from "next/server";
import { getDb } from "@/db/client";
import { bearerAuth } from "@/lib/auth/actor";
import { recordCall } from "@/lib/ops/agent-runs";
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
  return handleRest(request, path, {
    db: getDb(),
    resolveAuth: bearerAuth,
    // Recording runs after the response, so agents never wait for it, and it does not
    // depend on the worker, so runs keep recording while Valkey or the worker is down.
    recordCall: (r) => after(() => recordCall(getDb(), r).catch((e) => console.error(e))),
  });
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
