import { z } from "zod";
import { TOOLS } from "@/lib/tools/definitions";
import { inputSchema } from "@/lib/tools/registry";
import { MCP_INSTRUCTIONS } from "./server";

/**
 * Size of the tool list plus instructions an agent loads on connect, in bytes.
 * Raise only with a reason in the commit message.
 */
export const TOOL_LIST_BUDGET_BYTES = 38912;

/** The tools as MCP `tools/list` serialises them (REST-only tools left out): name, description and JSON input schema. */
export function toolListPayload(): { name: string; description: string; inputSchema: unknown }[] {
  return TOOLS.filter((def) => def.surface !== "rest").map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: z.toJSONSchema(inputSchema(def), { io: "input", unrepresentable: "any" }),
  }));
}

/** Bytes an agent spends on the tool list and the server instructions. */
export function toolListBytes(): number {
  return Buffer.byteLength(JSON.stringify(toolListPayload())) + Buffer.byteLength(MCP_INSTRUCTIONS);
}
