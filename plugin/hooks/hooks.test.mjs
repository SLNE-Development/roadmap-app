import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { docPathDecision, findLinkedRoot, REPLACEMENTS, sessionContext, skillDecision } from "./lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Creates a temporary linked repository with a nested subdirectory. */
function linkedRepo() {
  const root = mkdtempSync(join(tmpdir(), "surf-roadmap-"));
  writeFileSync(join(root, "surf-roadmap.json"), JSON.stringify({ project: "demo", board: "development" }));
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  return root;
}

/** Runs a hook script with `stdin` and returns its exit code and stdout. */
function run(script, stdin) {
  const env = { ...process.env, ROADMAP_URL: "", ROADMAP_API_KEY: "" };
  const result = spawnSync(process.execPath, [join(here, script)], { input: stdin, encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout };
}

test("finds the linked root from a subdirectory and nothing outside", () => {
  const root = linkedRepo();
  assert.equal(findLinkedRoot(join(root, "src", "deep")), root);
  assert.equal(findLinkedRoot(mkdtempSync(join(tmpdir(), "plain-"))), null);
});

test("maps every superpowers skill to its replacement", () => {
  assert.match(skillDecision("superpowers:brainstorming"), /surf-roadmap:plan-system/);
  assert.match(skillDecision("superpowers:writing-plans"), /surf-roadmap:write-plan/);
  assert.match(skillDecision("superpowers:subagent-driven-development"), /surf-roadmap:subagent-driven-development/);
  assert.match(skillDecision("superpowers:diagnosing-superpowers"), /not available/);
  assert.equal(skillDecision("surf-roadmap:plan-system"), null);
  assert.equal(skillDecision("frontend-design"), null);
  assert.equal(Object.keys(REPLACEMENTS).length, 15);
});

test("blocks document folders inside the linked repo only", () => {
  const root = linkedRepo();
  assert.match(docPathDecision(root, join(root, "docs", "superpowers", "specs", "x.md")), /write_spec/);
  assert.match(docPathDecision(root, "docs/adr/0001-x.md"), /create_adr/);
  assert.match(docPathDecision(root, join(root, "docs", "plans", "p.md")), /write_plan/);
  assert.equal(docPathDecision(root, join(root, "docs", "guide.md")), null);
  assert.equal(docPathDecision(root, join(root, "src", "docs", "adr.ts")), null);
  assert.equal(docPathDecision(root, join(tmpdir(), "docs", "adr", "x.md")), null);
});

test("describes the project and the override in the session context", () => {
  const text = sessionContext({ project: "demo", board: "development" }, "Signed in as Alex.");
  assert.match(text, /project `demo`/);
  assert.match(text, /superpowers:brainstorming → surf-roadmap:plan-system/);
  assert.ok(text.length < 10_000);
});

test("guard-skill denies superpowers in a linked repo and stays silent elsewhere", () => {
  const root = linkedRepo();
  const input = (cwd, skill) => JSON.stringify({ cwd, tool_name: "Skill", tool_input: { skill } });
  const denied = run("guard-skill.mjs", input(join(root, "src"), "superpowers:brainstorming"));
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  const named = run("guard-skill.mjs", JSON.stringify({ cwd: root, tool_name: "Skill", tool_input: { skill_name: "superpowers:writing-plans" } }));
  assert.match(JSON.parse(named.stdout).hookSpecificOutput.permissionDecisionReason, /write-plan/);
  assert.deepEqual(run("guard-skill.mjs", input(root, "surf-roadmap:plan-system")), { status: 0, stdout: "" });
  assert.deepEqual(run("guard-skill.mjs", input(mkdtempSync(join(tmpdir(), "plain-")), "superpowers:brainstorming")), { status: 0, stdout: "" });
});

test("guard-docs denies spec files and allows ordinary files", () => {
  const root = linkedRepo();
  const input = (file) => JSON.stringify({ cwd: root, tool_name: "Write", tool_input: { file_path: file } });
  assert.equal(JSON.parse(run("guard-docs.mjs", input(join(root, "docs", "specs", "a.md"))).stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(run("guard-docs.mjs", input(join(root, "src", "a.ts"))), { status: 0, stdout: "" });
  const notebook = JSON.stringify({ cwd: root, tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, "docs", "plans", "a.ipynb") } });
  assert.equal(JSON.parse(run("guard-docs.mjs", notebook).stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("hooks never block on malformed input", () => {
  for (const script of ["guard-skill.mjs", "guard-docs.mjs", "session-start.mjs"]) {
    for (const stdin of ["", "not json", "[]", "null", '{"tool_input":42}']) {
      assert.deepEqual(run(script, stdin), { status: 0, stdout: "" }, `${script} with ${JSON.stringify(stdin)}`);
    }
  }
});

test("session-start adds context in a linked repo", () => {
  const root = linkedRepo();
  const out = run("session-start.mjs", JSON.stringify({ cwd: root, hook_event_name: "SessionStart" }));
  assert.equal(out.status, 0);
  const ctx = JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /ROADMAP_URL or ROADMAP_API_KEY is not set/);
});

test("treats in-repo names starting with two dots as inside the repo", () => {
  const root = linkedRepo();
  assert.equal(docPathDecision(root, "..docs/adr/x.md"), null);
  assert.equal(docPathDecision(root, join(root, "..", "docs", "adr", "x.md")), null);
  assert.match(docPathDecision(root, "docs\\adr\\x.md"), /create_adr/);
});

test("session-start reports an invalid link file", () => {
  const root = mkdtempSync(join(tmpdir(), "surf-roadmap-bad-"));
  writeFileSync(join(root, "surf-roadmap.json"), "{ not json");
  const out = run("session-start.mjs", JSON.stringify({ cwd: root }));
  assert.equal(out.status, 0);
  assert.match(JSON.parse(out.stdout).hookSpecificOutput.additionalContext, /surf-roadmap\.json is invalid/);
});
