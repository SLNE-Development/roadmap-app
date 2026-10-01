import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import type { CallRecord } from "@/lib/ops/agent-runs";
import { TOOL_NAMES, TOOLS } from "@/lib/tools/definitions";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { MCP_PROMPTS } from "./prompts";
import { createMcpServer } from "./server";

/** Connects an in-memory MCP client to a server acting as `actor`, reporting calls to `recordCall`. */
async function connect(db: Db, actor: Actor, recordCall?: (r: CallRecord) => void): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db, actor, { apiKeyId: "key-1", recordCall }).connect(serverSide);
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
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.filter((t) => t.surface !== "rest").map((t) => t.name).sort());
    expect(tools.map((t) => t.name)).not.toContain("start_agent_run");
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
    expect(system.json.updates[0]).toMatchObject({ authorName: "Owner", agent: "Claude Code" });
  });

  it("reports a system without a spec as a null document", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const client = await connect(db, owner);
    await call(client, "create_system", { project: slug, slug: "shop", title: "Shop" });
    expect((await call(client, "get_document", { project: slug, system: "shop", kind: "spec" })).json).toEqual({ document: null });
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

  it("reports a missing numeric id as a required argument, not as NaN", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    const client = await connect(db, owner);
    const missing = await call(client, "update_task", { state: "doing" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("expected number, received undefined");
    expect(missing.text).not.toContain("NaN");
  });

  it("reports tool calls to the recorder", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const records: CallRecord[] = [];
    const client = await connect(db, owner, (r) => records.push(r));
    await call(client, "list_systems", { project: slug });
    await call(client, "list_systems", { project: "nope" });
    expect(records.map((r) => [r.tool, r.transport, r.ok, r.status, r.apiKeyId, r.agent])).toEqual([
      ["list_systems", "mcp", true, 200, "key-1", "Claude Code"],
      ["list_systems", "mcp", false, 404, "key-1", "Claude Code"],
    ]);
  });

  it("serves the project brief as a resource for the actor's projects only", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    await createProjectFixture(db, "other");
    const client = await connect(db, owner);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("roadmap://project/{slug}/brief");
    const { resources } = await client.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: "roadmap://project/demo/brief", name: "DEMO brief", mimeType: "text/markdown" })]);
    const read = await client.readResource({ uri: "roadmap://project/demo/brief" });
    expect((read.contents[0] as { text: string }).text.startsWith("# DEMO (demo)")).toBe(true);
    await expect(client.readResource({ uri: "roadmap://project/other/brief" })).rejects.toThrow();
  });

  it("offers the next, status and plan prompts, which only name registered tools", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    const client = await connect(db, owner);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["next", "plan", "status"]);
    const plan = await client.getPrompt({ name: "plan", arguments: { project: "demo", system: "search" } });
    expect((plan.messages[0].content as { text: string }).text).toContain("add_planning_round");
    for (const prompt of MCP_PROMPTS) {
      const text = prompt.text({ project: "demo", system: "search" });
      for (const name of text.match(/[a-z]+(?:_[a-z]+)+/g) ?? []) expect(TOOL_NAMES, `${prompt.name} names ${name}`).toContain(name);
    }
    expect(MCP_PROMPTS.find((p) => p.name === "plan")!.text({ project: "demo" }).length).toBeLessThanOrEqual(1500);
  });
});
