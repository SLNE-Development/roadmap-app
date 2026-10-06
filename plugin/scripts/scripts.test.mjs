import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditRepo,
  detectRestrictions,
  expectedBlocks,
  loadConventions,
  parseBlocks,
  planClaudeMd,
  planGitignore,
  removeSection,
  renderBlock,
  renderOtherAgents,
} from "./lib.mjs";

const conv = loadConventions(fileURLToPath(new URL("../conventions/", import.meta.url)));

/** The global CLAUDE.md this plugin's author had before removing their restrictions. */
const GLOBAL = `
# No subagents
Never use the Agent tool (or Workflow, or any other subagent-spawning mechanism) for any task.

When executing an implementation plan, always use the \`superpowers:executing-plans\` skill. Never use \`superpowers:subagent-driven-development\`.

# graphify
- **graphify** - any input to knowledge graph. Trigger: \`/graphify\`

# Commits
Write all commit messages in **English**.

# No worktrees
Never create or switch to a git worktree on your own initiative.
`;

test("detects and removes global worktree and subagent restrictions", () => {
  const found = detectRestrictions(GLOBAL);
  assert.equal(found.worktrees.heading, "No worktrees");
  assert.equal(found.subagents.heading, "No subagents");
  const withoutWorktrees = removeSection(GLOBAL, found.worktrees);
  assert.ok(!withoutWorktrees.includes("git worktree"));
  assert.ok(withoutWorktrees.includes("# Commits"));
  const cleaned = removeSection(withoutWorktrees, detectRestrictions(withoutWorktrees).subagents);
  assert.ok(!cleaned.includes("Agent tool"));
  assert.ok(cleaned.includes("# graphify"));
  assert.deepEqual(detectRestrictions(cleaned), { worktrees: null, subagents: null });
});

test("does not treat permissive sections as restrictions", () => {
  assert.deepEqual(detectRestrictions("# Worktrees\nUse git worktrees freely.\n"), { worktrees: null, subagents: null });
});

test("renders and parses marked blocks", () => {
  const md = `intro\n${renderBlock("commits", "Body", null)}\n${renderBlock("worktrees", "W", "allowed")}\n`;
  const blocks = parseBlocks(md);
  assert.equal(blocks.get("commits").text, "Body");
  assert.equal(blocks.get("worktrees").variant, "allowed");
});

test("adds missing blocks, reports divergent ones and updates only on request", () => {
  const blocks = expectedBlocks(conv, { worktrees: "forbidden", execution: "none" });
  assert.ok(blocks.some((b) => b.id === "worktrees" && b.variant === "forbidden"));
  assert.ok(!blocks.some((b) => b.id === "execution-mode"));
  const first = planClaudeMd("# My project\n\nOwn notes.\n", blocks, []);
  assert.ok(first.content.startsWith("# My project\n\nOwn notes.\n"));
  assert.equal(first.added.length, blocks.length);
  const edited = first.content.replace("All output is **English**", "All output is **German**");
  const again = planClaudeMd(edited, blocks, []);
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.divergent, ["language"]);
  assert.equal(again.content, edited);
  const fixed = planClaudeMd(edited, blocks, ["language"]);
  assert.deepEqual(fixed.updated, ["language"]);
  assert.ok(fixed.content.includes("All output is **English**"));
  assert.ok(fixed.content.includes("Own notes."));
});

test("appends gitignore entries once", () => {
  const first = planGitignore("node_modules\n", [".superpowers/", ".worktrees/"]);
  assert.deepEqual(first.added, [".superpowers/", ".worktrees/"]);
  assert.deepEqual(planGitignore(first.content, [".superpowers/"]).added, []);
});

test("audits a repository for link, blocks, gitignore, legacy docs and commits", () => {
  const repo = mkdtempSync(join(tmpdir(), "audit-"));
  mkdirSync(join(repo, "docs", "adr"), { recursive: true });
  writeFileSync(join(repo, "docs", "adr", "0001-x.md"), "# x");
  const log = [
    { subject: "feat: Add thing", body: "" },
    { subject: "added stuff", body: "" },
    { subject: "fix: Repair it", body: "Co-Authored-By: Claude <noreply@anthropic.com>" },
  ];
  const findings = auditRepo(repo, conv, log);
  const ids = findings.filter((f) => f.kind !== "conforming").map((f) => f.id);
  assert.ok(ids.includes("link"));
  assert.ok(ids.includes("claude-md:header"));
  assert.ok(ids.includes("gitignore:.superpowers/"));
  assert.ok(ids.includes("legacy:docs/adr"));
  assert.ok(ids.includes("commits:format"));
  assert.ok(ids.includes("commits:attribution"));
});

test("planClaudeMd round-trips CRLF files and a second run changes nothing", () => {
  const blocks = expectedBlocks(conv, { worktrees: "allowed", execution: "inline" });
  const existing = "# Mine\r\nnotes\r\n\r\n## Keep\r\nthis\r\n";
  const first = planClaudeMd(existing, blocks, []);
  assert.ok(first.content.startsWith(existing));
  assert.ok(!/(^|[^\r])\n/.test(first.content), "every line ending stays CRLF");
  assert.deepEqual(first.problems, []);
  const second = planClaudeMd(first.content, blocks, []);
  assert.deepEqual([second.added, second.updated, second.divergent, second.problems], [[], [], [], []]);
  assert.equal(second.content, first.content);
  const edited = first.content.replace("All output is **English**", "All output is **German**");
  const fixed = planClaudeMd(edited, blocks, ["language"]);
  assert.deepEqual(fixed.updated, ["language"]);
  assert.equal(fixed.content, first.content);
});

test("an unterminated start marker is reported and never appended to or replaced", () => {
  const blocks = expectedBlocks(conv, { worktrees: "none", execution: "none" });
  const orphan = "<!-- surf-roadmap:block id=language v=1 -->\nMy own text after a broken marker.\n";
  const plan = planClaudeMd(orphan, blocks, ["language"]);
  assert.ok(plan.problems.some((p) => p.id === "language" && p.kind === "unterminated"));
  assert.ok(!plan.added.includes("language") && !plan.updated.includes("language"));
  assert.ok(plan.content.includes("My own text after a broken marker."));
  assert.ok(plan.content.startsWith(orphan));
  const again = planClaudeMd(plan.content, blocks, ["language"]);
  assert.ok(again.content.includes("My own text after a broken marker."));
  assert.equal(again.content, plan.content);
  assert.ok(auditRepoClaude(plan.content).some((f) => f.id === "claude-md:language" && f.kind === "divergent"));
});

test("duplicate block ids are reported and left alone", () => {
  const blocks = expectedBlocks(conv, { worktrees: "none", execution: "none" });
  const once = planClaudeMd("", blocks, []).content;
  const language = blocks.find((b) => b.id === "language");
  const doubled = `${once}\n${renderBlock("language", language.text, null)}\n`;
  const plan = planClaudeMd(doubled, blocks, ["language"]);
  assert.ok(plan.problems.some((p) => p.id === "language" && p.kind === "duplicate"));
  assert.deepEqual(plan.updated, []);
  assert.equal(plan.content, doubled);
});

test("markers inside a code fence are not blocks", () => {
  const md = "```\n<!-- surf-roadmap:block id=x v=1 -->\nq\n<!-- surf-roadmap:end id=x -->\n```\n";
  assert.equal(parseBlocks(md).size, 0);
});

test("reports the innermost restriction section, not its parent", () => {
  const md = "# Rules\nGeneral.\n\n## No worktrees\nNever create a git worktree.\n\n## Style\nTabs.\n";
  const found = detectRestrictions(md);
  assert.equal(found.worktrees.heading, "No worktrees");
  const cleaned = removeSection(md, found.worktrees);
  assert.ok(cleaned.includes("# Rules") && cleaned.includes("General.") && cleaned.includes("## Style"));
  assert.ok(!cleaned.includes("worktree"));
});

test("a section matching both topics is reported for both", () => {
  const found = detectRestrictions("# Limits\nNever use worktrees and never spawn a subagent.\n");
  assert.ok(found.worktrees);
  assert.equal(found.worktrees, found.subagents);
});

/** Audits a CLAUDE.md text by writing it to a temporary repository. */
function auditRepoClaude(text) {
  const repo = mkdtempSync(join(tmpdir(), "audit-claude-"));
  writeFileSync(join(repo, "CLAUDE.md"), text);
  return auditRepo(repo, conv, []);
}

const cli = fileURLToPath(new URL("./surf-roadmap.mjs", import.meta.url));

/** Runs the CLI and returns its exit status and parsed JSON stdout. */
function run(...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout), stderr: r.stderr };
}

test("CLI prints JSON and exits 0 on success", () => {
  const repo = mkdtempSync(join(tmpdir(), "cli-"));
  const out = run("apply", "--repo", repo, "--project", "demo", "--worktrees", "allowed", "--execution", "inline");
  assert.equal(out.status, 0);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.claudeMd.added.length, 10);
  const audit = run("audit", "--repo", repo);
  assert.equal(audit.status, 0);
  assert.ok(audit.json.findings.every((f) => f.kind === "conforming"));
});

test("CLI has no whoami: the roadmap is reached through the MCP server, never the script", () => {
  const out = run("whoami");
  assert.equal(out.status, 1);
  assert.equal(out.json.ok, false);
  assert.match(out.json.error, /^usage: /);
  assert.doesNotMatch(out.json.error, /whoami/);
});

test("CLI reports failures as JSON with a non-zero exit", () => {
  const missing = join(tmpdir(), "surf-roadmap-does-not-exist");
  for (const args of [
    ["audit", "--repo", missing],
    ["apply", "--repo", missing, "--project", "demo"],
    ["apply", "--project"],
    ["apply", "--repo", missing, "--project", "demo", "--worktrees", "sometimes"],
    ["bogus"],
  ]) {
    const out = run(...args);
    assert.notEqual(out.status, 0, args.join(" "));
    assert.equal(out.json.ok, false);
    assert.equal(typeof out.json.error, "string");
    assert.equal(out.stderr, "");
  }
});

test("CLI apply merges into an existing link file", () => {
  const repo = mkdtempSync(join(tmpdir(), "cli-merge-"));
  writeFileSync(join(repo, "surf-roadmap.json"), JSON.stringify({ project: "old", board: "b1", extra: 1 }));
  assert.equal(run("apply", "--repo", repo, "--project", "new").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "surf-roadmap.json"), "utf8")), { project: "new", board: "b1", extra: 1 });
  writeFileSync(join(repo, "surf-roadmap.json"), "{ not json");
  assert.notEqual(run("apply", "--repo", repo, "--project", "new").status, 0);
});

test("CLI remove-global removes only the requested section", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-global-"));
  const file = join(dir, "CLAUDE.md");
  writeFileSync(file, "# Keep\r\nme\r\n\r\n# No worktrees\r\nNever use git worktree.\r\n");
  const out = run("remove-global", "--kind", "worktrees", "--file", file);
  assert.equal(out.json.ok, true);
  assert.equal(readFileSync(file, "utf8"), "# Keep\r\nme\r\n");
});

test("CLI other-agents writes AGENTS.md and the Cursor rule, and a rerun keeps the user's text", () => {
  const repo = mkdtempSync(join(tmpdir(), "cli-agents-"));
  writeFileSync(join(repo, "surf-roadmap.json"), JSON.stringify({ project: "demo" }));
  const out = run("other-agents", "--repo", repo, "--targets", "agents,cursor");
  assert.equal(out.status, 0);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.written.length, 2);
  const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("id=header") && agents.includes("id=roadmap") && agents.includes("id=commits"));
  assert.ok(agents.includes("/api/mcp") && agents.includes("`demo`"));
  const rule = readFileSync(join(repo, ".cursor", "rules", "surf-roadmap.mdc"), "utf8");
  assert.ok(rule.startsWith("---\ndescription: surf-roadmap conventions\nalwaysApply: true\n---\n"));
  assert.ok(rule.endsWith(agents));

  writeFileSync(join(repo, "AGENTS.md"), `My own paragraph.\n\n${agents}`);
  assert.equal(run("other-agents", "--repo", repo, "--targets", "agents,cursor").status, 0);
  assert.equal(readFileSync(join(repo, "AGENTS.md"), "utf8"), `My own paragraph.\n\n${agents}`);
});

test("renderOtherAgents names the linked project, or falls back to a whole sentence", () => {
  const linked = renderOtherAgents(conv, {}, { project: "demo" }).agentsMd;
  assert.ok(linked.includes("This repository is linked to the roadmap project `demo` (see `surf-roadmap.json`)."));
  const unknown = renderOtherAgents(conv, {}, null).agentsMd;
  assert.ok(unknown.includes("This repository is linked to a roadmap project (see `surf-roadmap.json`)."));
  assert.ok(!unknown.includes("{{") && !unknown.includes("`named in"));
});

test("CLI other-agents rejects an unknown target", () => {
  const repo = mkdtempSync(join(tmpdir(), "cli-agents-bad-"));
  const out = run("other-agents", "--repo", repo, "--targets", "vim");
  assert.equal(out.status, 1);
  assert.equal(out.json.ok, false);
  assert.equal(typeof out.json.error, "string");
});

test("CLI other-agents follows --worktrees like CLAUDE.md", () => {
  const repo = mkdtempSync(join(tmpdir(), "cli-agents-wt-"));
  assert.equal(run("other-agents", "--repo", repo, "--targets", "agents", "--worktrees", "forbidden").status, 0);
  const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("id=worktrees variant=forbidden"));
  const none = mkdtempSync(join(tmpdir(), "cli-agents-wt2-"));
  run("other-agents", "--repo", none, "--targets", "agents");
  assert.ok(!readFileSync(join(none, "AGENTS.md"), "utf8").includes("id=worktrees"));
});
