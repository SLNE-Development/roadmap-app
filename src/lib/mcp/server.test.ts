import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { TOOL_NAMES } from "@/lib/tools/definitions";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { createMcpServer } from "./server";

/** Connects an in-memory MCP client to a server acting as `actor`. */
async function connect(db: Db, actor: Actor): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db, actor).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

/** Calls a tool and returns its parsed JSON result and error flag. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError === true, text, json: result.isError ? null : JSON.parse(text) };
}

describe("MCP server", () => {
  it("lists every tool with instructions", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    const client = await connect(db, owner);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(client.getInstructions()).toContain("surf-roadmap:plan-system");
  });

  it("runs the whole flow as the key's user with the default agent", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const client = await connect(db, owner);
    await call(client, "create_system", { project: slug, slug: "shop", title: "Shop" });
    const gated = await call(client, "move_system", { project: slug, system: "shop", column: "Todo" });
    expect(gated.isError).toBe(true);
    expect(gated.text).toContain("System shop is still in planning.");

    const round = await call(client, "add_planning_round", {
      project: slug,
      system: "shop",
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: `${area}?` })),
    });
    await call(client, "answer_planning_items", {
      project: slug,
      system: "shop",
      answers: round.json.itemIds.map((itemId: string) => ({ itemId, answer: "Handled." })),
    });
    await call(client, "write_spec", { project: slug, system: "shop", body: "# Shop" });
    const done = await call(client, "complete_planning", { project: slug, system: "shop", userConfirmation: "Ship it." });
    expect(done.isError).toBe(false);
    const plan = await call(client, "write_plan", { project: slug, system: "shop", body: "## Plan", steps: [{ step: 1, title: "Cart" }] });
    const [taskId] = plan.json.createdTasks;
    await call(client, "update_task", { id: taskId, state: "doing" });
    await call(client, "post_update", { project: slug, system: "shop", taskId, summary: "Cart started", commit: "abc1234" });

    const system = await call(client, "get_system", { project: slug, system: "shop" });
    expect(system.json.tasks[0]).toMatchObject({ state: "doing", ownerName: "Owner" });
    expect(system.json.ownerName).toBe("Owner");
    expect(system.json.updates[0].author).toBe("Claude Code (for Owner)");
  });

  it("returns validation and permission errors as tool errors", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = (await createProjectFixture(db, "other")).owner;
    const client = await connect(db, stranger);
    const invisible = await call(client, "list_systems", { project: slug });
    expect(invisible).toMatchObject({ isError: true, text: `Unknown project ${slug}.` });
    const invalid = await call(client, "create_project", { slug: "Bad Slug", name: "x" });
    expect(invalid.isError).toBe(true);
  });
});
