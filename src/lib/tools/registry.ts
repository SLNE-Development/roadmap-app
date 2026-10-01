import { z } from "zod";
import type { Db } from "@/db/types";
import { withAgent, type Actor } from "@/lib/ops/actor";

/** HTTP methods REST routes use. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** What a tool call knows about its transport: the API key it came with, if any. */
export interface ToolContext {
  apiKeyId: string | null;
}

/** One operation, exposed as an MCP tool and as a REST route, or only as a REST route. */
export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  write: boolean;
  method: HttpMethod;
  path: string;
  /** Where the tool is offered: everywhere (the default) or only over REST. */
  surface?: "all" | "rest";
  run(db: Db, actor: Actor, input: Record<string, unknown>, ctx?: ToolContext): Promise<unknown>;
}

/** Typed form of {@link ToolDef} used while defining a tool. */
interface TypedToolDef<S extends z.ZodRawShape> extends Omit<ToolDef, "input" | "run"> {
  input: S;
  run(db: Db, actor: Actor, input: z.infer<z.ZodObject<S>>, ctx?: ToolContext): Promise<unknown>;
}

/** Declares a tool whose `run` receives input typed from its zod shape. */
export function defineTool<S extends z.ZodRawShape>(def: TypedToolDef<S>): ToolDef {
  return { ...def, run: (db, actor, input, ctx) => def.run(db, actor, input as z.infer<z.ZodObject<S>>, ctx) };
}

/** Optional agent name accepted by every write tool. */
const AGENT = {
  agent: z.string().trim().max(40).optional(),
};

/** Returns the full input schema of a tool: its shape, plus `agent` for write tools. */
export function inputSchema(def: ToolDef): z.ZodObject<z.ZodRawShape> {
  return z.object(def.write ? { ...def.input, ...AGENT } : def.input);
}

/**
 * Validates `raw` and runs the tool. Write tools act through the given agent,
 * or `defaultAgent` when the input names none. `ctx` carries the call's API key.
 *
 * @throws z.ZodError for invalid input, and whatever the op throws
 */
export async function runTool(
  db: Db,
  actor: Actor,
  def: ToolDef,
  raw: unknown,
  defaultAgent?: string,
  ctx: ToolContext = { apiKeyId: null },
): Promise<unknown> {
  const { agent, ...input } = inputSchema(def).parse(raw ?? {}) as Record<string, unknown>;
  const who = def.write ? withAgent(actor, (agent as string | undefined) ?? defaultAgent) : actor;
  return def.run(db, who, input, ctx);
}

/** Every registered tool; filled by `definitions.ts`. */
const registry: ToolDef[] = [];

/** Adds tools to the registry. */
export function register(...tools: ToolDef[]): void {
  registry.push(...tools);
}

/** Returns the registered tools. */
export function registeredTools(): readonly ToolDef[] {
  return registry;
}

/**
 * Finds the tool whose REST route matches `method` and the URL `segments`
 * after `/api/v1`, with the decoded `:param` values. A malformed percent
 * escape in a parameter segment matches nothing.
 */
export function matchRoute(method: string, segments: string[]): { def: ToolDef; params: Record<string, string> } | null {
  for (const def of registry) {
    if (def.method !== method) continue;
    const pattern = def.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    try {
      const ok = pattern.every((part, i) => {
        if (part.startsWith(":")) {
          params[part.slice(1)] = decodeURIComponent(segments[i]);
          return true;
        }
        return part === segments[i];
      });
      if (ok) return { def, params };
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
  }
  return null;
}
