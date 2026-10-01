import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { system } from "@/db/schema";
import type { Executor } from "@/db/types";
import { parseGroups } from "@/lib/activity-groups";
import { bearerActor, sessionActor } from "@/lib/auth/actor";
import { ApiKeyRateLimitedError, rateLimitedResponse } from "@/lib/auth/rate-limit";
import { csvRow } from "@/lib/csv";
import { projectAccess } from "@/lib/ops/access";
import type { Actor } from "@/lib/ops/actor";
import { listActivity, type HistoryEntry } from "@/lib/ops/activity";
import { messageOf, statusOf } from "@/lib/ops/errors";

/** The export reads the database per request on Node. */
export const dynamic = "force-dynamic";

/** How many changes one database page of the export holds. */
const PAGE_SIZE = 500;

/** The columns of the export. */
const HEADER = ["id", "created_at", "author", "agent", "entity", "entity_id", "system", "field", "old_value", "new_value"];

/** What {@link handleActivityCsv} needs: the database and the resolved actor, `null` without a valid session or key. */
export interface ActivityCsvDeps {
  db: Executor;
  actor: Actor | null;
}

/** Returns a JSON error response. */
function fail(error: unknown): Response {
  const status = statusOf(error);
  if (status === 500) console.error(error);
  return Response.json({ error: messageOf(error) }, { status });
}

/** Returns one change as a CSV row; `systems` maps system ids to slugs. */
function rowOf(entry: HistoryEntry, systems: Map<string, string>): string {
  return csvRow([
    entry.id,
    entry.createdAt.toISOString(),
    entry.authorName,
    entry.agent,
    entry.entity,
    entry.entityId,
    entry.systemId ? (systems.get(entry.systemId) ?? null) : null,
    entry.field,
    entry.oldValue,
    entry.newValue,
  ]);
}

/**
 * Streams the project's activity as CSV, newest first, filtered by the `person`, `agents`, `groups` and `system`
 * query parameters. Access and the first page are checked before the stream starts, so failures answer JSON:
 * 401 without an actor, 404 for a project the actor cannot see.
 *
 * @param request the incoming request
 * @param deps the database and the actor
 * @param slug the project slug
 */
export async function handleActivityCsv(request: Request, deps: ActivityCsvDeps, slug: string): Promise<Response> {
  const { db, actor } = deps;
  if (!actor) return Response.json({ error: "Sign in or send Authorization: Bearer <ROADMAP_API_KEY>." }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const agents = params.get("agents");
    const groups = parseGroups(params.get("groups") ?? undefined);
    const filter = {
      system: params.get("system") || undefined,
      person: params.get("person") || undefined,
      agents: agents === "only" || agents === "exclude" ? agents : undefined,
      groups: groups.length ? groups : undefined,
      limit: PAGE_SIZE,
    } as const;
    const { project } = await projectAccess(db, actor, slug, "viewer");
    const systems = new Map(
      (await db.select({ id: system.id, slug: system.slug }).from(system).where(eq(system.projectId, project.id))).map((s) => [s.id, s.slug]),
    );
    let page = await listActivity(db, actor, slug, filter);
    let first = true;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          let text = first ? csvRow(HEADER) : "";
          first = false;
          text += page.map((e) => rowOf(e, systems)).join("");
          const next = page.length >= PAGE_SIZE ? page.at(-1)?.id : undefined;
          controller.enqueue(encoder.encode(text));
          if (next === undefined) return controller.close();
          page = await listActivity(db, actor, slug, { ...filter, before: next });
        } catch (error) {
          controller.error(error);
        }
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.slug}-activity-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}

/** Exports the activity as CSV for a signed-in member or a bearer API key. */
export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }): Promise<Response> {
  const { project } = await params;
  let actor: Actor | null;
  try {
    actor = (await sessionActor()) ?? (await bearerActor(request));
  } catch (error) {
    if (error instanceof ApiKeyRateLimitedError) return rateLimitedResponse(error);
    return fail(error);
  }
  return handleActivityCsv(request, { db: getDb(), actor }, project);
}
