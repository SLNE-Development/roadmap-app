import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { ForbiddenError } from "@/lib/ops/errors";
import { ZodError } from "zod";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { TOOLS } from "./definitions";
import { inputSchema, matchRoute, runTool } from "./registry";

/** Every tool the spec lists, in spec order. */
const SPEC_TOOLS = [
  "whoami",
  "list_projects", "get_project", "create_project", "update_project", "list_members",
  "list_boards", "create_board", "update_board", "set_board_columns",
  "list_domains", "create_domain", "update_domain", "reorder_domains",
  "list_phases", "create_phase", "update_phase", "reorder_phases",
  "list_systems", "get_system", "create_system", "update_system", "set_dependencies", "set_system_fields", "move_system", "archive_system",
  "get_planning", "add_planning_round", "answer_planning_items", "complete_planning", "reopen_planning",
  "get_document", "write_spec", "write_plan",
  "add_task", "update_task", "set_task_checks", "move_task",
  "post_update", "list_updates",
  "list_adrs", "get_adr", "create_adr", "update_adr", "accept_adr", "supersede_adr",
  "list_questions", "add_question", "answer_question",
  "list_activity",
];

describe("tool registry", () => {
  it("defines exactly the tools of the spec, each once", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...SPEC_TOOLS].sort());
  });

  it("gives every tool a unique REST route whose parameters are tool inputs", () => {
    const routes = TOOLS.map((t) => `${t.method} ${t.path}`);
    expect(new Set(routes).size).toBe(routes.length);
    for (const t of TOOLS) {
      for (const param of t.path.split("/").filter((s) => s.startsWith(":"))) {
        expect(Object.keys(t.input), `${t.name} ${param}`).toContain(param.slice(1));
      }
    }
  });

  it("adds an optional agent to write tools only", () => {
    const write = TOOLS.find((t) => t.name === "post_update")!;
    const read = TOOLS.find((t) => t.name === "list_systems")!;
    expect(Object.keys(inputSchema(write).shape)).toContain("agent");
    expect(Object.keys(inputSchema(read).shape)).not.toContain("agent");
  });

  it("matches routes and decodes parameters", () => {
    const m = matchRoute("POST", ["projects", "demo", "systems", "a%2Db", "move"]);
    expect(m?.def.name).toBe("move_system");
    expect(m?.params).toEqual({ project: "demo", system: "a-b" });
    expect(matchRoute("GET", ["projects", "demo", "adrs", "3"])?.def.name).toBe("get_adr");
    expect(matchRoute("DELETE", ["projects"])).toBeNull();
    expect(matchRoute("GET", ["nope"])).toBeNull();
  });

  it("runs a tool with validation and the agent default", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const create = TOOLS.find((t) => t.name === "create_system")!;
    await runTool(db, owner, create, { project: slug, slug: "s", title: "S" }, "Claude Code");
    const post = TOOLS.find((t) => t.name === "post_update")!;
    await runTool(db, owner, post, { project: slug, system: "s", summary: "hi" }, "Claude Code");
    const list = TOOLS.find((t) => t.name === "list_updates")!;
    const updates = (await runTool(db, owner, list, { project: slug })) as { author: string }[];
    expect(updates[0].author).toBe("Claude Code (for Owner)");
    await expect(runTool(db, owner, create, { project: slug })).rejects.toThrow(/slug/);
  });

  it("returns null for a malformed percent-encoded segment", () => {
    expect(matchRoute("GET", ["projects", "%"])).toBeNull();
    expect(matchRoute("GET", ["projects", "%E0%A4%A"])).toBeNull();
  });

  it("lets an explicit agent override the default and keeps it out of the op input", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await runTool(db, owner, TOOLS.find((t) => t.name === "create_system")!, { project: slug, slug: "s", title: "S" });
    const post = TOOLS.find((t) => t.name === "post_update")!;
    await runTool(db, owner, post, { project: slug, system: "s", summary: "hi", agent: "Other Bot" }, "Claude Code");
    const list = TOOLS.find((t) => t.name === "list_updates")!;
    const updates = (await runTool(db, owner, list, { project: slug })) as { author: string }[];
    expect(updates[0].author).toBe("Other Bot (for Owner)");
  });

  it("rejects a write tool called by a viewer with ForbiddenError", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const create = TOOLS.find((t) => t.name === "create_system")!;
    await expect(runTool(db, viewer, create, { project: slug, slug: "s", title: "S" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects invalid input with a ZodError", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const create = TOOLS.find((t) => t.name === "create_system")!;
    await expect(runTool(db, owner, create, { project: slug })).rejects.toBeInstanceOf(ZodError);
  });
});
