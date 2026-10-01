import { z } from "zod";
import type { Db } from "@/db/types";
import { ApiKeyRateLimitedError, rateLimitedResponse } from "@/lib/auth/rate-limit";
import { withAgent, type Actor } from "@/lib/ops/actor";
import { notifyRecorder, UNRECORDED_TOOLS, type CallRecord } from "@/lib/ops/agent-runs";
import { InvalidError, messageOf, statusOf } from "@/lib/ops/errors";
import "./definitions";
import { inputSchema, matchRoute, runTool, type ToolDef } from "./registry";

/** What the REST handler needs from its environment. */
export interface RestDeps {
  db: Db;
  /** Returns the request's actor and API key, or `null` without a valid key; throws {@link ApiKeyRateLimitedError} when rate limited. */
  resolveAuth(request: Request): Promise<{ actor: Actor; apiKeyId: string } | null>;
  /** Receives every tool call made with a key, except the run tools themselves; must not throw (errors are logged). */
  recordCall?: (r: CallRecord) => void;
}

/** Builds the call record of one REST tool call; the outcome is the error, or `null` on success. */
function restRecord(
  def: ToolDef,
  auth: { actor: Actor; apiKeyId: string },
  input: Record<string, unknown>,
  at: Date,
  started: number,
  error: unknown,
): CallRecord {
  const failed = error !== null;
  return {
    apiKeyId: auth.apiKeyId,
    userId: auth.actor.userId,
    agent: withAgent(auth.actor, typeof input.agent === "string" ? input.agent : undefined).agent ?? null,
    tool: def.name,
    transport: "rest",
    input,
    ok: !failed,
    status: failed ? statusOf(error) : 200,
    error: failed ? messageOf(error) : null,
    durationMs: performance.now() - started,
    at,
  };
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
 * A repeated key keeps the last value.
 *
 * @throws InvalidError for a key the tool does not declare
 */
export function coerceQuery(shape: z.ZodRawShape, params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!(key in shape)) throw new InvalidError(`Unknown query parameter "${key}". Allowed: ${Object.keys(shape).join(", ")}.`);
    out[key] = isBoolean(shape[key] as z.ZodType | undefined) && (value === "true" || value === "false") ? value === "true" : value;
  }
  return out;
}

/**
 * Reads a JSON object body, or an empty object when the body is blank.
 *
 * @throws InvalidError when the body is not valid JSON or not a plain object
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InvalidError("Request body must be a JSON object.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvalidError("Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

/**
 * Handles `/api/v1/<segments>`: finds the tool for the method and path, checks
 * the API key, merges query or body with the path parameters (path parameters
 * win), and runs it.
 * Responds 404 for unknown routes, 401 without a valid key, 429 (with
 * `Retry-After` when known) for a rate-limited key, and the op's status on errors
 * (including errors from the key check itself). Calls made with a key go to
 * `deps.recordCall`; a failing recorder never changes the response.
 */
export async function handleRest(request: Request, segments: string[], deps: RestDeps): Promise<Response> {
  const method = request.method.toUpperCase();
  const match = matchRoute(method, segments.filter(Boolean));
  if (!match) return Response.json({ error: `No route ${method} /api/v1/${segments.join("/")}.` }, { status: 404 });
  let auth: { actor: Actor; apiKeyId: string } | null = null;
  let input: Record<string, unknown> = { ...match.params };
  let at = new Date();
  let started = 0;
  /** Reports the finished call, unless it was made without a key or its tool is not recorded. */
  const record = (error: unknown) => {
    if (auth && !UNRECORDED_TOOLS.has(match.def.name)) notifyRecorder(deps.recordCall, restRecord(match.def, auth, input, at, started, error));
  };
  try {
    auth = await deps.resolveAuth(request);
    if (!auth) return Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer <key>." }, { status: 401 });
    at = new Date();
    started = performance.now();
    const raw =
      method === "GET" || method === "DELETE"
        ? coerceQuery(inputSchema(match.def).shape, new URL(request.url).searchParams)
        : await readBody(request);
    input = { ...raw, ...match.params };
    const result = await runTool(deps.db, auth.actor, match.def, input, undefined, { apiKeyId: auth.apiKeyId });
    record(null);
    return Response.json(result === undefined ? { ok: true } : result);
  } catch (error) {
    record(error);
    if (error instanceof ApiKeyRateLimitedError) return rateLimitedResponse(error);
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
}
