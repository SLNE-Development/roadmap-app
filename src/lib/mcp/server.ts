import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";
import { TOOLS } from "@/lib/tools/definitions";
import { inputSchema, runTool } from "@/lib/tools/registry";

/** Rules the server gives every connecting agent. */
export const MCP_INSTRUCTIONS = [
  "Roadmap with projects, boards (workstreams with custom columns) and systems. Every tool takes the project slug.",
  "1. Every new system goes through the surf-roadmap:plan-system interview: create_system, then for each round add_planning_round BEFORE asking and answer_planning_items right after the user answers, then write_spec, show it, and complete_planning with the user's verbatim confirmation. The server refuses to move a system out of planning, or to start its tasks, before that.",
  "2. Specs, plans, ADRs and open questions live here, never as repository files: write_spec, write_plan, create_adr/accept_adr/supersede_adr, add_question.",
  "3. When you start a task, update_task with state doing (this makes the key's user owner of the task and of an unowned system). After every commit, post_update with the commit hash. When finished, set tasks done and move the system to a review or done column. When stuck, set the task blocked and add_question.",
  "4. Pass agent with your name on writes; it defaults to Claude Code.",
  "5. get_system, list_adrs and list_activity are brief by default; use get_document or get_adr for full text.",
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

/**
 * Builds an MCP server exposing every registered tool, acting as `actor`.
 * Write tools default to the agent name "Claude Code".
 */
export function createMcpServer(db: Db, actor: Actor): McpServer {
  const server = new McpServer({ name: "surf-roadmap", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: inputSchema(def).shape, annotations: { readOnlyHint: !def.write } },
      (args: Record<string, unknown>) => toResult(() => runTool(db, actor, def, args, "Claude Code")),
    );
  }
  return server;
}
