import { describe, expect, it } from "vitest";
import { TOOL_LIST_BUDGET_BYTES, toolListBytes, toolListPayload } from "./tool-list";

/** Collects every `description` string in a JSON schema. */
function descriptions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => descriptions(n, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" && typeof value === "string") out.push(value);
      else descriptions(value, out);
    }
  }
  return out;
}

describe("tool list size", () => {
  it("stays within the byte budget", () => {
    expect(toolListBytes()).toBeLessThanOrEqual(TOOL_LIST_BUDGET_BYTES);
  });

  it("keeps every tool description at 200 characters or fewer", () => {
    const long = toolListPayload().filter((t) => t.description.length > 200).map((t) => `${t.name} (${t.description.length})`);
    expect(long).toEqual([]);
  });

  it("keeps every field description at 80 characters or fewer", () => {
    const long = toolListPayload().flatMap((t) => descriptions(t.inputSchema).filter((d) => d.length > 80).map((d) => `${t.name}: ${d}`));
    expect(long).toEqual([]);
  });
});
