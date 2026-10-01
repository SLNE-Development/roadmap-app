import "server-only";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "@/db/types";
import { withAgent, type Actor } from "@/lib/ops/actor";
import { notifyRecorder, UNRECORDED_TOOLS, type CallRecord } from "@/lib/ops/agent-runs";
import { projectBrief } from "@/lib/ops/brief";
import { messageOf, statusOf } from "@/lib/ops/errors";
import { listProjects } from "@/lib/ops/projects";
import { TOOLS } from "@/lib/tools/definitions";
import { inputSchema, runTool } from "@/lib/tools/registry";
import { MCP_PROMPTS } from "./prompts";

/** Rules the server gives every connecting agent. */
export const MCP_INSTRUCTIONS = [
  "Roadmap of projects, boards and systems. project and system arguments are slugs.",
  "1. Every new system goes through the surf-roadmap:plan-system interview: create_system, then for each round add_planning_round BEFORE asking and answer_planning_items right after the user answers, then write_spec, show it, and complete_planning with the user's verbatim confirmation. The server refuses to move a system out of planning, or to start its tasks, before that.",
  "2. Specs, plans, ADRs and open questions live here, never as repository files: write_spec, write_plan, create_adr/accept_adr/supersede_adr, add_question.",
  "3. When you start a task, update_task with state doing (this makes the key's user owner of the task and of an unowned system). After every commit, post_update with the commit hash. When finished, set tasks done and move the system to a review or done column. When stuck, set the task blocked and add_question.",
  "4. Accepted ADRs are immutable: supersede_adr instead of editing. Column entry rules (list_boards) may refuse a move_system.",
  "5. Pass agent with your name on writes; it defaults to Claude Code. Batch tools (up to 50 items) apply all or nothing.",
  "6. get_system, list_adrs and list_activity are brief by default; use get_document or get_adr for full text.",
  "7. Event requests: read with get_request, ask the planner with ask_requester.",
].join("\n");

/** Wraps a tool result, or an error message, as MCP text content. */
async function toResult(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await fn();
    return { content: [{ type: "text", text: JSON.stringify(result === undefined ? { ok: true } : result, null, 2) }] };
  } catch (error) {
    if (statusOf(error) === 500) console.error(error);
    return { content: [{ type: "text", text: messageOf(error) }], isError: true };
  }
}

/** The agent name write tools default to. */
const DEFAULT_AGENT = "Claude Code";

/**
 * Builds an MCP server exposing every registered tool except REST-only ones, acting as `actor`.
 * Write tools default to the agent name "Claude Code". With `opts.apiKeyId`, every
 * tool call except {@link UNRECORDED_TOOLS} goes to `opts.recordCall`; a failing recorder never changes the result.
 */
export function createMcpServer(db: Db, actor: Actor, opts: { apiKeyId?: string; recordCall?: (r: CallRecord) => void } = {}): McpServer {
  const server = new McpServer({ name: "surf-roadmap", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  const apiKeyId = opts.apiKeyId ?? null;
  for (const def of TOOLS) {
    if (def.surface === "rest") continue;
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: inputSchema(def).shape, annotations: { readOnlyHint: !def.write } },
      async (args: Record<string, unknown>) => {
        const at = new Date();
        const started = performance.now();
        let failure: unknown = null;
        const result = await toResult(async () => {
          try {
            return await runTool(db, actor, def, args, DEFAULT_AGENT, { apiKeyId });
          } catch (error) {
            failure = error;
            throw error;
          }
        });
        if (apiKeyId && !UNRECORDED_TOOLS.has(def.name)) {
          notifyRecorder(opts.recordCall, {
            apiKeyId,
            userId: actor.userId,
            agent: withAgent(actor, typeof args?.agent === "string" ? args.agent : DEFAULT_AGENT).agent ?? null,
            tool: def.name,
            transport: "mcp",
            input: args ?? {},
            ok: failure === null,
            status: failure === null ? 200 : statusOf(failure),
            error: failure === null ? null : messageOf(failure),
            durationMs: performance.now() - started,
            at,
          });
        }
        return result;
      },
    );
  }
  server.registerResource(
    "project-brief",
    new ResourceTemplate("roadmap://project/{slug}/brief", {
      list: async () => ({
        resources: (await listProjects(db, actor)).map((p) => ({ uri: `roadmap://project/${p.slug}/brief`, name: `${p.name} brief`, mimeType: "text/markdown" })),
      }),
    }),
    { description: "A short markdown brief of a project: phases, active and blocked systems, open questions.", mimeType: "text/markdown" },
    async (uri, { slug }) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await projectBrief(db, actor, String(slug)) }],
    }),
  );
  for (const prompt of MCP_PROMPTS) {
    server.registerPrompt(prompt.name, { description: prompt.description, argsSchema: prompt.args }, (args) => ({
      messages: [{ role: "user", content: { type: "text", text: prompt.text({ project: String(args.project), system: typeof args.system === "string" ? args.system : undefined }) } }],
    }));
  }
  return server;
}
