import { z } from "zod";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";
import "./definitions";
import { inputSchema, matchRoute, runTool } from "./registry";

/** What the REST handler needs from its environment. */
export interface RestDeps {
  db: Db;
  resolveActor(request: Request): Promise<Actor | null>;
}

/** Returns whether a schema is a boolean, looking through optional, default and nullable wrappers. */
function isBoolean(schema: z.ZodType | undefined): boolean {
  let current: unknown = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault || current instanceof z.ZodNullable) {
    current = current.unwrap();
  }
  return current instanceof z.ZodBoolean;
}

/**
 * Converts query parameters into tool input: `true`/`false` become booleans for
 * boolean inputs; everything else stays a string (numbers are coerced by their schemas).
 */
export function coerceQuery(shape: z.ZodRawShape, params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) {
    out[key] = isBoolean(shape[key] as z.ZodType | undefined) && (value === "true" || value === "false") ? value === "true" : value;
  }
  return out;
}

/** Reads a JSON object body, or an empty object when there is none or it is not an object. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Handles `/api/v1/<segments>`: finds the tool for the method and path, checks
 * the API key, merges query or body with the path parameters (path parameters
 * win), and runs it.
 * Responds 404 for unknown routes, 401 without a valid key, and the op's status on errors.
 */
export async function handleRest(request: Request, segments: string[], deps: RestDeps): Promise<Response> {
  const method = request.method.toUpperCase();
  const match = matchRoute(method, segments.filter(Boolean));
  if (!match) return Response.json({ error: `No route ${method} /api/v1/${segments.join("/")}.` }, { status: 404 });
  const actor = await deps.resolveActor(request);
  if (!actor) return Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer <key>." }, { status: 401 });
  const raw =
    method === "GET" || method === "DELETE"
      ? coerceQuery(inputSchema(match.def).shape, new URL(request.url).searchParams)
      : await readBody(request);
  try {
    const result = await runTool(deps.db, actor, match.def, { ...raw, ...match.params });
    return Response.json(result ?? { ok: true });
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
}
