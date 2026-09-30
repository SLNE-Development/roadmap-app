import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
