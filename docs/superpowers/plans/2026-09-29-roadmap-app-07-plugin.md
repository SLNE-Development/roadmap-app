# Part 7: The surf-roadmap plugin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** A Claude Code plugin marketplace in this repository with one plugin, `surf-roadmap`. It connects to the app's MCP server, sets repositories up, carries the surf-claude conventions (adapted to the database), replaces every superpowers skill with a roadmap-aware one, blocks raw superpowers use and file-based specs, plans and ADRs in linked repositories, and ships subagents pinned to models.

**Spec:** section 10 (all subsections).

Everything in `plugin/` is plain Node (ES modules, no dependencies) and Markdown. Tests use Node's built-in runner: `npm run test:plugin`. Hooks run in exec form (`node` plus `args`), so they work on Windows, macOS and Linux.

Plugin behaviour facts this part relies on (checked against the Claude Code docs on 2026-09-29):
- `PreToolUse` hooks receive JSON on stdin with `cwd`, `tool_name` and `tool_input`; they deny a call by printing `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` and exiting 0. No output and exit 0 means "no decision".
- The Skill tool's input names the skill in `skill` (current tool schema) or `skill_name` (hooks docs); the guard reads both.
- `SessionStart` hooks add context with `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}` (at most 10,000 characters).
- Plugin subagents support `name`, `description`, `tools`, `disallowedTools`, `model` (`sonnet`, `opus`, `haiku`, …) and `effort` (`low` … `max`); `hooks`, `mcpServers` and `permissionMode` are ignored for plugin agents.
- `.mcp.json` of a plugin expands `${VAR}` in `url` and `headers` of http servers.

---

### Task 7.1: Marketplace, manifest and MCP configuration

**Files:**
- Create: `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/LICENSES/superpowers-MIT.txt`, `plugin/README.md`

- [ ] **Step 1: Write the marketplace and the manifest**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "surf-roadmap",
  "owner": { "name": "SLNE Development", "url": "https://github.com/SLNE-Development" },
  "plugins": [
    {
      "name": "surf-roadmap",
      "source": "./plugin",
      "description": "Roadmap-driven workflow for Claude Code: planning interviews, specs, plans, ADRs and questions in the roadmap app instead of repository files, plus the surf conventions and model-pinned subagents."
    }
  ]
}
```

`plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "surf-roadmap",
  "displayName": "surf roadmap",
  "version": "1.0.0",
  "description": "Connects Claude Code to the roadmap app: exhaustive planning interviews, database-held specs, plans, ADRs and questions, progress tracking, the surf conventions, and replacements for every superpowers skill.",
  "author": { "name": "SLNE Development", "url": "https://github.com/SLNE-Development" },
  "homepage": "https://github.com/SLNE-Development/roadmap-app",
  "repository": "https://github.com/SLNE-Development/roadmap-app",
  "license": "MIT",
  "keywords": ["roadmap", "planning", "adr", "mcp", "workflow", "conventions"]
}
```

`plugin/.mcp.json`:

```json
{
  "mcpServers": {
    "surf-roadmap": {
      "type": "http",
      "url": "${ROADMAP_URL}/api/mcp",
      "headers": { "Authorization": "Bearer ${ROADMAP_API_KEY}" }
    }
  }
}
```

- [ ] **Step 2: Add the superpowers licence notice**

```bash
mkdir -p plugin/LICENSES
cp /c/Users/hombe/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/LICENSE plugin/LICENSES/superpowers-MIT.txt
head -3 plugin/LICENSES/superpowers-MIT.txt
```

Expected: `MIT License` and `Copyright (c) 2025 Jesse Vincent`. If the path does not exist, find the installed superpowers with `ls /c/Users/hombe/.claude/plugins/cache/*/superpowers/` and use the highest version; record that version in `plugin/README.md` where it says `6.4.1`.

- [ ] **Step 3: Write the plugin README**

`plugin/README.md`:

````markdown
# surf-roadmap

Claude Code plugin for the roadmap app. In every repository linked to a roadmap
project it:

- runs an exhaustive, adversarial planning interview before any system is built
  (`/surf-roadmap:plan`), stores every round in the roadmap and writes the spec there;
- writes implementation plans into the roadmap (their steps become tasks) and
  executes them while posting progress after every commit;
- records ADRs and open questions in the roadmap;
- applies the surf conventions (English only, ask never assume, Conventional
  Commits without AI attribution, doc comments that say what code does);
- replaces every superpowers skill with a roadmap-aware one and blocks the originals;
- ships subagents pinned to models (implementer on sonnet, reviewers on sonnet and opus, ADR writer on haiku, …).

## Install

```
/plugin marketplace add SLNE-Development/roadmap-app
/plugin install surf-roadmap@surf-roadmap
```

Create an API key in the app (account menu → API keys) and set the two lines it
shows as environment variables before starting Claude Code:

```
ROADMAP_URL=https://roadmap.example.com
ROADMAP_API_KEY=rmk_…
```

Then, in each repository: `/surf-roadmap:setup`.

## What "linked" means

A repository is linked when `surf-roadmap.json` exists at its root:

```json
{ "project": "surf-roleplay", "board": "development" }
```

Hooks only act in linked repositories. Elsewhere, superpowers and everything else
behave as usual.

## Skills

| Skill | Replaces |
| --- | --- |
| `setup`, `check-project` | surf-claude `new-project`, `check-project` |
| `using-surf-roadmap` | superpowers `using-superpowers` |
| `plan-system` | superpowers `brainstorming` |
| `write-plan` | superpowers `writing-plans`, surf-claude `new-plan` |
| `execute-plan` | superpowers `executing-plans` |
| `subagent-driven-development`, `dispatching-parallel-agents`, `using-git-worktrees`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch`, `writing-skills` | the superpowers skills of the same name |
| `new-adr` | surf-claude `new-adr` |
| `open-question`, `track-work` | — |

The forked skills are adapted from superpowers 6.4.1 by Jesse Vincent, MIT
licensed; see `LICENSES/superpowers-MIT.txt`.

## Commands

`/surf-roadmap:plan <idea>`, `/surf-roadmap:status`, `/surf-roadmap:next`,
`/surf-roadmap:setup`.
````

- [ ] **Step 4: Validate and commit**

```bash
claude plugin validate ./plugin
git add .claude-plugin plugin
git commit -m "feat(plugin): Add the surf-roadmap marketplace, manifest and MCP config"
```

Expected: `Validation passed` (warnings about missing components are fine at this point). If `claude` is not on the PATH, note it and continue; Task 7.8 repeats the validation.

---

### Task 7.2: Hooks: session context, superpowers guard, document guard

**Files:**
- Create: `plugin/hooks/hooks.json`, `plugin/hooks/lib.mjs`, `plugin/hooks/session-start.mjs`, `plugin/hooks/guard-skill.mjs`, `plugin/hooks/guard-docs.mjs`
- Test: `plugin/hooks/hooks.test.mjs`

**Interfaces:**
- Produces (from `lib.mjs`): `LINK_FILE`, `REPLACEMENTS: Record<string, string | null>`, `BLOCKED_DOC_DIRS: string[]`, `readInput(): Promise<object | null>`, `findLinkedRoot(start: string): string | null`, `readLink(root: string): { project: string; board?: string } | null`, `skillDecision(skill: string): string | null`, `docPathDecision(root: string, filePath: string): string | null`, `sessionContext(link, who: string): string`, `denyJson(reason: string): string`.

- [ ] **Step 1: Write the failing tests**

`plugin/hooks/hooks.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:plugin`
Expected: FAIL, `./lib.mjs` not found.

- [ ] **Step 3: Implement the hook library**

`plugin/hooks/lib.mjs`:

```js
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** File at a repository's root that links it to a roadmap project. */
export const LINK_FILE = "surf-roadmap.json";

/** Replacement surf-roadmap skill for every superpowers skill; null means none. */
export const REPLACEMENTS = {
  "using-superpowers": "using-surf-roadmap",
  brainstorming: "plan-system",
  "writing-plans": "write-plan",
  "executing-plans": "execute-plan",
  "subagent-driven-development": "subagent-driven-development",
  "dispatching-parallel-agents": "dispatching-parallel-agents",
  "using-git-worktrees": "using-git-worktrees",
  "test-driven-development": "test-driven-development",
  "systematic-debugging": "systematic-debugging",
  "verification-before-completion": "verification-before-completion",
  "requesting-code-review": "requesting-code-review",
  "receiving-code-review": "receiving-code-review",
  "finishing-a-development-branch": "finishing-a-development-branch",
  "writing-skills": "writing-skills",
  "diagnosing-superpowers": null,
};

/** Repository folders that must not hold specs, plans or ADRs, with the MCP tool to use instead. */
export const BLOCKED_DOC_DIRS = [
  ["docs/superpowers/", "write_spec (specs) or write_plan (plans)"],
  ["docs/specs/", "write_spec"],
  ["docs/spec/", "write_spec"],
  ["docs/plans/", "write_plan"],
  ["docs/adr/", "create_adr"],
];

/** Reads the hook's JSON input from stdin; returns null for empty or malformed input or a non-object. */
export async function readInput() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  try {
    const value = JSON.parse(data);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Returns the nearest directory at or above `start` that contains the link file, or null. */
export function findLinkedRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, LINK_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Reads and validates the link file of a linked root; returns null when it is unreadable or has no project. */
export function readLink(root) {
  try {
    const value = JSON.parse(readFileSync(join(root, LINK_FILE), "utf8"));
    return value && typeof value.project === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Returns why a skill may not run in a linked repository, or null when it may. */
export function skillDecision(skill) {
  const match = /^superpowers:(.+)$/.exec(String(skill ?? ""));
  if (!match) return null;
  const name = match[1];
  if (!(name in REPLACEMENTS)) return `superpowers:${name} is disabled in this repository by surf-roadmap. Use the matching surf-roadmap:* skill.`;
  const replacement = REPLACEMENTS[name];
  return replacement
    ? `superpowers:${name} is disabled in this repository. Use surf-roadmap:${replacement} instead; it follows the same method and keeps specs, plans and progress in the roadmap.`
    : `superpowers:${name} is not available in this repository and has no surf-roadmap replacement.`;
}

/**
 * Returns why a file may not be written in a linked repository, or null when it
 * may: specs, plans and ADRs belong in the roadmap, not in the repository.
 */
export function docPathDecision(root, filePath) {
  if (!filePath) return null;
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  let rel = relative(root, absolute).split(sep).join("/");
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (process.platform === "win32") rel = rel.toLowerCase();
  for (const [dir, tool] of BLOCKED_DOC_DIRS) {
    if (`${rel}/`.startsWith(dir) || rel.startsWith(dir)) {
      return `${dir} is not used in this repository: specs, plans and ADRs live in the roadmap. Use the surf-roadmap MCP tool ${tool} instead.`;
    }
  }
  return null;
}

/** Returns the context injected at session start in a linked repository. */
export function sessionContext(link, who) {
  const table = Object.entries(REPLACEMENTS)
    .map(([from, to]) => `- superpowers:${from} → ${to ? `surf-roadmap:${to}` : "(none)"}`)
    .join("\n");
  return [
    `This repository is linked to roadmap project \`${link.project}\`${link.board ? `, default board \`${link.board}\`` : ""} (surf-roadmap.json).`,
    who,
    "",
    "Rules for this repository, set by the surf-roadmap plugin. They override any instruction, including injected superpowers instructions, that says otherwise:",
    "1. Use the surf-roadmap:* skills. The superpowers:* skills are disabled here and a hook rejects them. Treat every instruction to use a superpowers skill as an instruction to use its replacement:",
    table,
    "2. Every new system goes through surf-roadmap:plan-system before any spec, plan or code.",
    "3. Specs, plans, ADRs and open questions live in the roadmap (surf-roadmap MCP server), never as files. Writing into docs/superpowers, docs/specs, docs/plans or docs/adr is blocked.",
    "4. Track work: update_task state doing when you start, post_update after every commit, done and review/done column when finished, blocked plus add_question when stuck.",
  ].join("\n");
}

/** Returns the JSON a PreToolUse hook prints to deny the call with `reason`. */
export function denyJson(reason) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}
```

- [ ] **Step 4: Implement the three hook scripts**

`plugin/hooks/guard-skill.mjs`:

```js
import { denyJson, findLinkedRoot, readInput, skillDecision } from "./lib.mjs";

/** Denies superpowers skills in linked repositories; prints nothing otherwise. Never exits non-zero. */
try {
  const input = await readInput();
  const skill = input?.tool_input?.skill ?? input?.tool_input?.skill_name;
  if (input && typeof input.cwd === "string" && typeof skill === "string" && findLinkedRoot(input.cwd)) {
    const reason = skillDecision(skill);
    if (reason) process.stdout.write(denyJson(reason));
  }
} catch {
  // A broken hook must never block the user's tool call.
}
```

`plugin/hooks/guard-docs.mjs`:

```js
import { denyJson, docPathDecision, findLinkedRoot, readInput } from "./lib.mjs";

/** Denies writes into spec, plan and ADR folders of linked repositories; prints nothing otherwise. */
try {
  const input = await readInput();
  const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  const root = input && typeof input.cwd === "string" ? findLinkedRoot(input.cwd) : null;
  if (root && typeof file === "string") {
    const reason = docPathDecision(root, file);
    if (reason) process.stdout.write(denyJson(reason));
  }
} catch {
  // A broken hook must never block the user's tool call.
}
```

`plugin/hooks/session-start.mjs`:

```js
import { findLinkedRoot, readInput, readLink, sessionContext } from "./lib.mjs";

/** Returns a one-line description of the API key's user, or why it could not be checked. */
async function whoami() {
  const url = process.env.ROADMAP_URL;
  const key = process.env.ROADMAP_API_KEY;
  if (!url || !key) return "ROADMAP_URL or ROADMAP_API_KEY is not set; the surf-roadmap MCP server cannot connect. Run /surf-roadmap:setup.";
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/api/v1/whoami`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401) return "The roadmap rejected ROADMAP_API_KEY (401). Create a new key in the app.";
    if (!response.ok) return `The roadmap answered ${response.status}; MCP tools may fail.`;
    const me = await response.json();
    return `Signed in to the roadmap as ${me.name}.`;
  } catch {
    return `The roadmap at ${url} did not answer within 3 seconds; MCP tools may fail.`;
  }
}

/** Adds the linked project and the plugin's rules to the session; prints nothing outside linked repositories. */
try {
  const input = await readInput();
  const root = input && typeof input.cwd === "string" ? findLinkedRoot(input.cwd) : null;
  const link = root ? readLink(root) : null;
  if (link) {
    const additionalContext = sessionContext(link, await whoami());
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  }
} catch {
  // A broken hook must never break session start.
}
```

`plugin/hooks/hooks.json`:

```json
{
  "description": "surf-roadmap: project context at session start; blocks superpowers skills and file-based specs, plans and ADRs in linked repositories.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"], "timeout": 10 }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Skill",
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard-skill.mjs"], "timeout": 10 }]
      },
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard-docs.mjs"], "timeout": 10 }]
      }
    ]
  }
}
```

- [ ] **Step 5: Run and commit**

```bash
npm run test:plugin
git add plugin/hooks
git commit -m "feat(plugin): Add session context and guards against superpowers and file-based docs"
```

Expected: all 8 tests pass.

---

### Task 7.3: Conventions and the setup/audit script

**Files:**
- Create: `plugin/conventions/manifest.json`, `plugin/conventions/claude-md/*.md` (12 files), `plugin/scripts/lib.mjs`, `plugin/scripts/surf-roadmap.mjs`
- Test: `plugin/scripts/scripts.test.mjs`

**Interfaces:**
- Produces (from `plugin/scripts/lib.mjs`): `findSections(md): Section[]`, `detectRestrictions(md): { worktrees: Section | null; subagents: Section | null }`, `removeSection(md, section): string`, `renderBlock(id, text, variant?): string`, `parseBlocks(md): Map<string, { variant: string | null; text: string; start: number; end: number }>`, `loadConventions(dir): Conventions`, `expectedBlocks(conv, answers): { id; variant; text }[]`, `planClaudeMd(existing, blocks, update: string[]): { content; added: string[]; updated: string[]; divergent: string[] }`, `planGitignore(existing, entries): { content; added: string[] }`, `auditRepo(repo, conv, gitLog?): Finding[]`.
- CLI: `node surf-roadmap.mjs <whoami|detect-global|remove-global|apply|audit> [flags]`, JSON on stdout.

- [ ] **Step 1: Write the convention blocks**

Create `plugin/conventions/claude-md/` with exactly these files. Each file holds only the block body; the script adds the markers.

`00-header.md`:

```markdown
# Project conventions

This section is managed by the `surf-roadmap` plugin. Everything between a
`surf-roadmap:block` marker and its matching `surf-roadmap:end` marker comes from
one shared definition: `/surf-roadmap:setup` writes it and
`/surf-roadmap:check-project` audits it. Change the plugin, not these blocks.
Anything outside the markers is project-specific and is never read or rewritten.

**Precedence.** These rules override any global or user-level `CLAUDE.md`,
personal defaults and tool defaults for work in this repository. Where this file
is silent, other instructions apply.
```

`05-roadmap.md`:

```markdown
## Roadmap

This repository is linked to the roadmap project named in `surf-roadmap.json`.
Specs, implementation plans, ADRs and open questions live in the roadmap and are
read and written through the `surf-roadmap` MCP server. No agent writes them as
files: no `docs/specs`, `docs/plans`, `docs/adr`, `docs/superpowers`, `SPEC.md` or
similar.

Use the `surf-roadmap:*` skills. They replace the `superpowers:*` skills in this
repository, which are blocked. Keep the roadmap current while working: start a
task with `update_task` (state `doing`), `post_update` after every commit, and
mark tasks and systems done when finished.
```

`10-language.md`:

```markdown
## Language

All output is **English**: code, identifiers, comments, doc comments, commit
messages, branch names, specs, plans, ADRs, questions, progress updates and the
agent's own replies in chat.

This holds whatever language the human writes in and whatever language existing
files use. If the human writes in German, the agent answers in English. The agent
does not ask whether to translate and does not mirror the human's language.
```

`20-never-assume.md`:

```markdown
## Never assume — ask

Agents do not get to decide. When a task is underspecified, when two reasonable
implementations exist, or when a name, format, dependency, trade-off or scope
boundary is open, the agent **asks the human, using the question tool, before
writing code**.

- A plausible default is not permission.
- "I picked the common option" is not an acceptable justification.
- If the agent catches itself about to write "I assumed", it stops and asks instead.
- Related questions are batched into one round rather than drip-fed one at a time.

The only decisions an agent may make alone are the ones with no lasting
consequence and no alternative worth naming.
```

`30-adr.md`:

```markdown
## Decisions become ADRs

**Every decision that requires a human becomes an ADR in the roadmap.**

A decision requires a human when it:

- constrains future work,
- is expensive to reverse,
- trades one desirable property against another,
- affects the security model,
- changes a public API, a wire format or an on-disk format, or
- adds a runtime dependency.

Process: the agent identifies the decision, asks the human with the real options
and their real trade-offs, and only after the human decides records it with
`/surf-roadmap:new-adr` (`create_adr`, then `accept_adr` once the human confirms
the text). ADRs are numbered by the roadmap and **immutable once accepted**. A
changed decision is a new ADR; the old one is superseded with `supersede_adr`,
and its text is never edited.
```

`40-workflow.md`:

````markdown
## Workflow: prompt -> interview -> spec -> plan -> execution

```
1. Prompt              The human states what they want.
2. Planning interview  /surf-roadmap:plan-system asks question rounds until every area
                       is covered and every risk is answered or explicitly accepted.
                       Every round is stored in the roadmap.
3. Spec                Written to the roadmap with write_spec and confirmed by the
                       human in their own words; complete_planning records it.
4. Plan                Only after planning is complete: /surf-roadmap:write-plan,
                       stored with write_plan; its steps become the system's tasks.
5. Execution           /surf-roadmap:execute-plan or
                       /surf-roadmap:subagent-driven-development, as the
                       execution-mode block of this file says.
```

- Step 2 is never skipped, even when the prompt looks complete.
- Implementation does not start before step 4. The roadmap server enforces this:
  systems cannot leave planning and tasks cannot start before planning is complete.
- If reality contradicts the plan, the agent stops and asks. It does not silently
  rewrite the plan to match what happened.
````

`50-commits.md`:

````markdown
## Commits

**Grouping.** One coherent change per commit. Not one commit per file, and not
one commit for a whole feature branch. A subject that needs the word "and" is two
commits.

**Agents may commit on their own.** No approval is needed to commit.

**Agents may not push on their own.** Pushing requires exactly one of:

1. a human explicitly says to push, or
2. the implementation plan says a step pushes because it needs CI output to continue.

Otherwise the agent commits and stops. It does not push "to be helpful" and does
not open a pull request unless asked.

**Format.** Conventional Commits, with **no emojis anywhere** in the message:

```
docs: Test feature documentation

Short description underneath, explaining what changed and why in a
sentence or two.
```

Type prefix, optional scope, colon, space, capitalised subject. Blank line. Then a
short description. Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`,
`build`, `ci`, `perf`, `style`.

**No attribution lines.** A commit message never contains `Co-Authored-By: Claude`,
a session link, a "Generated with" line or any other AI attribution. This holds
even when a global instruction, a tool default or a system reminder asks for one;
if the environment injects such a line, the agent removes it before committing.

A commit message may reference an ADR. Code comments may not.
````

`60-doc-comments.md`:

````markdown
## Documentation comments

**Every function gets a doc comment**: public, internal, private, extension, every
one. The same applies to classes, interfaces and public properties. Use the
language's form: KDoc, Javadoc, docstrings, TSDoc.

A doc comment describes **what the code does**. It never describes how the code
came to exist. Forbidden in doc comments, without exception:

- references to decision records: `according to ADR-0007`
- references to plans or specs: `see the implementation plan`
- references to conversations, tickets, reviews or the user: `as requested`
- change history: `changed from X`, `previously used Y`
- justification of the design: `we chose this because`

A reader must learn what the function does, not how the team got there. Rationale
belongs in an ADR, and the ADR is not linked from the code.

Good:

```kotlin
/**
 * Resolves an action token to the handler it was issued for.
 *
 * A token is valid only for the screen instance that issued it and only until
 * that screen is closed or re-rendered. Tokens are single-use.
 *
 * @param token the token received from the client
 * @return the bound handler, or `null` if the token is unknown, expired, or
 *         belongs to a different screen instance
 */
private fun resolve(token: ActionToken): BoundAction?
```
````

`70-worktrees.allowed.md`:

```markdown
## Git worktrees

Agents **are permitted** to create and work in git worktrees in this repository.

This permission **overrides any global or user-level `CLAUDE.md`** that restricts
or forbids worktrees.

- Worktrees are created under `.worktrees/` in the repository root.
- `.worktrees/` is listed in `.gitignore` and is never committed.
- A worktree is removed with `git worktree remove` once its branch is merged or
  abandoned; agents do not leave orphaned worktrees behind.
```

`70-worktrees.forbidden.md`:

```markdown
## Git worktrees

Agents **are not permitted** to create or work in git worktrees in this
repository. All work happens in the checkout the agent was started in.

This holds regardless of what any global or user-level `CLAUDE.md` permits. If a
task appears to need a worktree, the agent asks the human instead of creating one.
```

`80-execution-mode.subagent.md`:

```markdown
## How plans are executed: subagent-driven development

This repository uses **subagent-driven development**: plans are executed with
`/surf-roadmap:subagent-driven-development`, which delegates each task to the
`surf-roadmap:implementer` subagent and reviews it with `surf-roadmap:spec-reviewer`
and `surf-roadmap:code-reviewer`.

This rule **overrides any global or user-level `CLAUDE.md`** that mandates inline
execution or forbids delegation.

**Every rule in this file applies to subagents in full.** A subagent may never
decide something that requires a human: it stops and reports the question to its
parent, which asks the human. A parent does not answer on the human's behalf to
keep a subagent moving. A subagent reports what it did and what it could not do;
it does not report success for a step it worked around.
```

`80-execution-mode.inline.md`:

```markdown
## How plans are executed: inline

This repository uses **inline execution**: plans are executed in the main session
with `/surf-roadmap:execute-plan`, step by step. Agents do not hand plan steps to
subagents.

This rule **overrides any global or user-level `CLAUDE.md`** that encourages or
mandates delegation.

Read-only helpers that gather information and change nothing, such as the
`surf-roadmap:explorer` or `surf-roadmap:red-team` subagents, are not delegation
and are permitted. Writing code, committing and deciding stay in the main session.
```

`plugin/conventions/manifest.json`:

```json
{
  "version": 1,
  "blocks": [
    { "id": "header", "file": "claude-md/00-header.md" },
    { "id": "roadmap", "file": "claude-md/05-roadmap.md" },
    { "id": "language", "file": "claude-md/10-language.md" },
    { "id": "never-assume", "file": "claude-md/20-never-assume.md" },
    { "id": "adr", "file": "claude-md/30-adr.md" },
    { "id": "workflow", "file": "claude-md/40-workflow.md" },
    { "id": "commits", "file": "claude-md/50-commits.md" },
    { "id": "doc-comments", "file": "claude-md/60-doc-comments.md" },
    {
      "id": "worktrees",
      "question": "worktrees",
      "variants": { "allowed": "claude-md/70-worktrees.allowed.md", "forbidden": "claude-md/70-worktrees.forbidden.md" }
    },
    {
      "id": "execution-mode",
      "question": "execution",
      "variants": { "subagent": "claude-md/80-execution-mode.subagent.md", "inline": "claude-md/80-execution-mode.inline.md" }
    }
  ],
  "gitignore": [
    { "entry": ".superpowers/", "always": true },
    { "entry": ".claude/settings.local.json", "always": true },
    { "entry": ".worktrees/", "when": { "worktrees": "allowed" } }
  ],
  "forbiddenPaths": ["docs/superpowers", "docs/specs", "docs/spec", "docs/plans", "docs/adr", "SPEC.md", "docs/SPEC.md"],
  "commits": {
    "subjectPattern": "^(feat|fix|docs|refactor|chore|test|build|ci|perf|style)(\\([a-z0-9._/-]+\\))?!?: [A-Z].*$",
    "maxSubjectLength": 72,
    "sampleSize": 40,
    "forbiddenBodyPatterns": ["Co-Authored-By:", "Generated with \\[?Claude", "https?://claude\\.ai/"]
  }
}
```

- [ ] **Step 2: Write the failing script tests**

`plugin/scripts/scripts.test.mjs`:

```js
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:plugin`
Expected: the new file fails with `./lib.mjs` not found; the hook tests still pass.

- [ ] **Step 4: Implement the script library**

`plugin/scripts/lib.mjs`:

```js
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Words that turn a section about worktrees or subagents into a restriction. */
const RESTRICTIVE = /\b(never|don't|do not|must not|forbid\w*|not permitted|not allowed|only .{0,40}when .{0,40}ask)\b/i;

/** Topic patterns of the two restrictions setup asks about. */
const TOPICS = {
  worktrees: /worktree/i,
  subagents: /\b(subagents?|agent tool|subagent-driven|delegat\w+)\b/i,
};

/**
 * Splits markdown into heading sections. A section runs from its heading to the
 * next heading of the same or a higher level.
 *
 * @return sections with 0-based `start` (heading line) and exclusive `end` line indexes
 */
export function findSections(md) {
  const lines = md.split("\n");
  const headings = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) headings.push({ start: i, level: m[1].length, heading: m[2].trim() });
  });
  return headings.map((h, idx) => {
    const next = headings.slice(idx + 1).find((n) => n.level <= h.level);
    const end = next ? next.start : lines.length;
    return { ...h, end, text: lines.slice(h.start, end).join("\n") };
  });
}

/** Finds the sections of a global CLAUDE.md that forbid worktrees or subagents, if any. */
export function detectRestrictions(md) {
  const sections = findSections(md);
  const pick = (topic) => sections.find((s) => TOPICS[topic].test(s.text) && RESTRICTIVE.test(s.text)) ?? null;
  return { worktrees: pick("worktrees"), subagents: pick("subagents") };
}

/** Returns `md` without `section`, collapsing the blank lines left behind. */
export function removeSection(md, section) {
  const lines = md.split("\n");
  lines.splice(section.start, section.end - section.start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Wraps a block body in the surf-roadmap markers. */
export function renderBlock(id, text, variant) {
  const v = variant ? ` variant=${variant}` : "";
  return `<!-- surf-roadmap:block id=${id}${v} v=1 -->\n${text.trim()}\n<!-- surf-roadmap:end id=${id} -->`;
}

/** Parses every marked block of a CLAUDE.md by id, with its variant, body and character range. */
export function parseBlocks(md) {
  const blocks = new Map();
  const re = /<!-- surf-roadmap:block id=([a-z-]+)(?: variant=([a-z]+))? v=\d+ -->\n([\s\S]*?)\n<!-- surf-roadmap:end id=\1 -->/g;
  for (const m of md.matchAll(re)) {
    blocks.set(m[1], { variant: m[2] ?? null, text: m[3].trim(), start: m.index, end: m.index + m[0].length });
  }
  return blocks;
}

/** Loads the conventions directory: the manifest plus the text of every block file. */
export function loadConventions(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const read = (file) => readFileSync(join(dir, file), "utf8");
  return { manifest, read };
}

/**
 * Returns the blocks a repository should carry for the setup answers.
 *
 * @param answers `worktrees`: allowed | forbidden | none; `execution`: subagent | inline | none
 */
export function expectedBlocks(conv, answers) {
  const out = [];
  for (const block of conv.manifest.blocks) {
    if (!block.variants) {
      out.push({ id: block.id, variant: null, text: conv.read(block.file).trim() });
      continue;
    }
    const choice = answers[block.question];
    if (choice && choice !== "none" && block.variants[choice]) {
      out.push({ id: block.id, variant: choice, text: conv.read(block.variants[choice]).trim() });
    }
  }
  return out;
}

/**
 * Plans the new CLAUDE.md: missing blocks are appended, blocks whose text or
 * variant differs are reported as divergent and replaced only when their id is in
 * `update`. Text outside the markers is never changed.
 */
export function planClaudeMd(existing, blocks, update) {
  let content = existing;
  const added = [];
  const updated = [];
  const divergent = [];
  for (const b of blocks) {
    const current = parseBlocks(content).get(b.id);
    const rendered = renderBlock(b.id, b.text, b.variant);
    if (!current) {
      content = `${content.replace(/\s*$/, "")}${content.trim() ? "\n\n" : ""}${rendered}\n`;
      added.push(b.id);
    } else if (current.text !== b.text || current.variant !== b.variant) {
      if (update.includes(b.id)) {
        content = content.slice(0, current.start) + rendered + content.slice(current.end);
        updated.push(b.id);
      } else {
        divergent.push(b.id);
      }
    }
  }
  return { content, added, updated, divergent };
}

/** Appends gitignore entries that are missing; existing lines are never touched. */
export function planGitignore(existing, entries) {
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const added = entries.filter((e) => !present.has(e));
  const content = added.length ? `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n" : ""}${added.join("\n")}\n` : existing;
  return { content, added };
}

/**
 * Audits a repository: link file, convention blocks, gitignore entries, legacy
 * document folders and a sample of commits. Each finding has an `id`, a `kind`
 * (missing | divergent | conforming), `what` was found, and the `change` proposed.
 *
 * @param gitLog recent commits as `{ subject, body }`, newest first
 */
export function auditRepo(repo, conv, gitLog = []) {
  const findings = [];
  const add = (id, kind, what, change = "") => findings.push({ id, kind, what, change });
  const linkPath = join(repo, "surf-roadmap.json");
  let link = null;
  try {
    link = JSON.parse(readFileSync(linkPath, "utf8"));
  } catch {
    link = null;
  }
  if (!link?.project) add("link", "missing", "surf-roadmap.json is missing or has no project.", "Run /surf-roadmap:setup.");
  else add("link", "conforming", `Linked to project ${link.project}.`);

  const claude = existsSync(join(repo, "CLAUDE.md")) ? readFileSync(join(repo, "CLAUDE.md"), "utf8") : "";
  const present = parseBlocks(claude);
  const answers = {
    worktrees: present.get("worktrees")?.variant ?? "none",
    execution: present.get("execution-mode")?.variant ?? "none",
  };
  for (const b of expectedBlocks(conv, answers)) {
    const current = present.get(b.id);
    if (!current) add(`claude-md:${b.id}`, "missing", `CLAUDE.md has no ${b.id} block.`, "Append the block.");
    else if (current.text !== b.text) add(`claude-md:${b.id}`, "divergent", `The ${b.id} block differs from the current convention.`, "Replace the block body.");
    else add(`claude-md:${b.id}`, "conforming", `${b.id} block is current.`);
  }

  const gitignore = existsSync(join(repo, ".gitignore")) ? readFileSync(join(repo, ".gitignore"), "utf8") : "";
  for (const g of conv.manifest.gitignore) {
    const wanted = g.always || (g.when && answers.worktrees === g.when.worktrees);
    if (!wanted) continue;
    const has = gitignore.split(/\r?\n/).some((l) => l.trim() === g.entry);
    add(`gitignore:${g.entry}`, has ? "conforming" : "missing", has ? `.gitignore has ${g.entry}.` : `.gitignore lacks ${g.entry}.`, "Append the entry.");
  }

  for (const path of conv.manifest.forbiddenPaths) {
    if (existsSync(join(repo, path))) {
      add(`legacy:${path}`, "divergent", `${path} exists; specs, plans and ADRs belong in the roadmap.`, "Import its contents into the roadmap, then delete it after the human confirms.");
    }
  }

  const rules = conv.manifest.commits;
  const subject = new RegExp(rules.subjectPattern);
  const sample = gitLog.slice(0, rules.sampleSize);
  const badFormat = sample.filter((c) => !subject.test(c.subject) || c.subject.length > rules.maxSubjectLength);
  const attributed = sample.filter((c) => rules.forbiddenBodyPatterns.some((p) => new RegExp(p, "i").test(`${c.subject}\n${c.body}`)));
  if (badFormat.length) add("commits:format", "divergent", `${badFormat.length} of the last ${sample.length} commits break the subject format, e.g. "${badFormat[0].subject}".`, "Reported only; the next commit conforms.");
  if (attributed.length) add("commits:attribution", "divergent", `${attributed.length} recent commits carry AI attribution.`, "Reported only; history is never rewritten.");
  if (sample.length && !badFormat.length && !attributed.length) add("commits", "conforming", "Recent commits follow the rules.");
  return findings;
}
```

- [ ] **Step 5: Implement the CLI**

`plugin/scripts/surf-roadmap.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditRepo, detectRestrictions, expectedBlocks, loadConventions, planClaudeMd, planGitignore, removeSection } from "./lib.mjs";

const conv = loadConventions(fileURLToPath(new URL("../conventions/", import.meta.url)));

/** Parses `--name value` flags into an object. */
function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "true" : argv[++i];
  }
  return out;
}

/** Prints a JSON result and exits with `code`. */
function done(result, code = 0) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(code);
}

/** Reads a text file, or returns an empty string when it does not exist. */
function readOr(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Returns recent commits of `repo` as `{ subject, body }`, or an empty list outside git. */
function gitLog(repo) {
  try {
    const raw = execFileSync("git", ["-C", repo, "log", "-40", "--format=%s%x1f%b%x1e"], { encoding: "utf8" });
    return raw
      .split("\x1e")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [subject, body = ""] = c.split("\x1f");
        return { subject: subject.trim(), body: body.trim() };
      });
  } catch {
    return [];
  }
}

const [command, ...rest] = process.argv.slice(2);
const f = flags(rest);
const globalFile = f.file ?? join(homedir(), ".claude", "CLAUDE.md");

switch (command) {
  case "whoami": {
    const url = process.env.ROADMAP_URL;
    const key = process.env.ROADMAP_API_KEY;
    if (!url || !key) done({ ok: false, error: `Missing ${!url ? "ROADMAP_URL" : "ROADMAP_API_KEY"}. Set both, then restart Claude Code.` }, 1);
    try {
      const response = await fetch(`${url.replace(/\/+$/, "")}/api/v1/whoami`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) done({ ok: false, status: response.status, error: body.error ?? response.statusText }, 1);
      done({ ok: true, ...body });
    } catch (error) {
      done({ ok: false, error: `Could not reach ${url}: ${error.message}` }, 1);
    }
    break;
  }
  case "detect-global": {
    const found = detectRestrictions(readOr(globalFile));
    const view = (s) => (s ? { heading: s.heading, text: s.text } : null);
    done({ file: globalFile, worktrees: view(found.worktrees), subagents: view(found.subagents) });
    break;
  }
  case "remove-global": {
    const kind = f.kind;
    if (kind !== "worktrees" && kind !== "subagents") done({ ok: false, error: "--kind must be worktrees or subagents" }, 1);
    const text = readOr(globalFile);
    const section = detectRestrictions(text)[kind];
    if (!section) done({ ok: true, removed: null });
    writeFileSync(globalFile, removeSection(text, section));
    done({ ok: true, file: globalFile, removed: section.text });
    break;
  }
  case "apply": {
    const repo = f.repo ?? process.cwd();
    if (!f.project) done({ ok: false, error: "--project is required" }, 1);
    const answers = { worktrees: f.worktrees ?? "none", execution: f.execution ?? "none" };
    writeFileSync(join(repo, "surf-roadmap.json"), `${JSON.stringify({ project: f.project, ...(f.board ? { board: f.board } : {}) }, null, 2)}\n`);
    const claudePath = join(repo, "CLAUDE.md");
    const claude = planClaudeMd(readOr(claudePath), expectedBlocks(conv, answers), (f.update ?? "").split(",").filter(Boolean));
    writeFileSync(claudePath, claude.content);
    const entries = conv.manifest.gitignore.filter((g) => g.always || (g.when && answers.worktrees === g.when.worktrees)).map((g) => g.entry);
    const ignorePath = join(repo, ".gitignore");
    const ignore = planGitignore(readOr(ignorePath), entries);
    if (ignore.added.length) writeFileSync(ignorePath, ignore.content);
    done({ ok: true, link: { project: f.project, board: f.board ?? null }, claudeMd: { added: claude.added, updated: claude.updated, divergent: claude.divergent }, gitignore: ignore.added });
    break;
  }
  case "audit": {
    const repo = f.repo ?? process.cwd();
    const order = { missing: 0, divergent: 1, conforming: 2 };
    done({ findings: auditRepo(repo, conv, gitLog(repo)).sort((a, b) => order[a.kind] - order[b.kind]) });
    break;
  }
  default:
    done({ ok: false, error: "usage: surf-roadmap.mjs <whoami|detect-global|remove-global|apply|audit> [flags]" }, 1);
}
```

- [ ] **Step 6: Run and commit**

```bash
npm run test:plugin
node plugin/scripts/surf-roadmap.mjs detect-global --file /nonexistent
git add plugin/conventions plugin/scripts
git commit -m "feat(plugin): Add conventions and the setup and audit script"
```

Expected: all plugin tests pass; the CLI prints `{"file": "/nonexistent", "worktrees": null, "subagents": null}`.

---

### Task 7.4: New skills: using-surf-roadmap, setup, check-project, plan-system, new-adr, open-question, track-work

**Files:**
- Create: `plugin/skills/using-surf-roadmap/SKILL.md`, `plugin/skills/setup/SKILL.md`, `plugin/skills/check-project/SKILL.md`, `plugin/skills/plan-system/SKILL.md`, `plugin/skills/new-adr/SKILL.md`, `plugin/skills/open-question/SKILL.md`, `plugin/skills/track-work/SKILL.md`

- [ ] **Step 1: Write `using-surf-roadmap`**

`plugin/skills/using-surf-roadmap/SKILL.md`:

```markdown
---
name: using-surf-roadmap
description: Use at the start of every conversation in a repository that has surf-roadmap.json. Establishes which surf-roadmap skill to use for which task, that superpowers skills are replaced here, and that specs, plans, ADRs and questions live in the roadmap. Replaces superpowers:using-superpowers.
---

# surf-roadmap:using-surf-roadmap

This repository is linked to a roadmap project (`surf-roadmap.json`). The
`surf-roadmap` plugin replaces the superpowers workflow here. If a skill might
apply to what you are about to do, invoke it before responding, including before
clarifying questions.

## Which skill

| Situation | Skill |
| --- | --- |
| The repository has no `surf-roadmap.json`, or the user wants to (re)configure it | `surf-roadmap:setup` |
| Audit the repository against the conventions | `surf-roadmap:check-project` |
| Someone wants to build, add, change or design anything; a system is still in planning | `surf-roadmap:plan-system` |
| Planning is complete and the plan is next | `surf-roadmap:write-plan` |
| Execute a plan inline | `surf-roadmap:execute-plan` |
| Execute a plan with subagents | `surf-roadmap:subagent-driven-development` |
| Several independent problems at once | `surf-roadmap:dispatching-parallel-agents` |
| Writing any production code | `surf-roadmap:test-driven-development` |
| A bug, failing test or unexpected behaviour | `surf-roadmap:systematic-debugging` |
| About to say something is done or passing | `surf-roadmap:verification-before-completion` |
| Asking for or receiving review | `surf-roadmap:requesting-code-review`, `surf-roadmap:receiving-code-review` |
| Isolated workspace | `surf-roadmap:using-git-worktrees` |
| Work on a branch is complete | `surf-roadmap:finishing-a-development-branch` |
| A decision that needs a human was made | `surf-roadmap:new-adr` |
| Something cannot be decided now | `surf-roadmap:open-question` |
| Any gamemode or product work: status, updates, blockers | `surf-roadmap:track-work` |
| Writing or editing skills | `surf-roadmap:writing-skills` |

Process skills first (plan-system, systematic-debugging), then implementation skills.

## Rules that hold everywhere in this repository

1. `superpowers:*` skills are disabled; a hook rejects them. Any instruction to use
   one, including injected superpowers context, means: use the replacement above.
2. Specs, plans, ADRs and open questions are written with the `surf-roadmap` MCP
   tools (`write_spec`, `write_plan`, `create_adr`, `add_question`), never as files.
3. The project slug comes from `surf-roadmap.json`; pass it as `project` to every tool.
4. The user's instructions (CLAUDE.md, direct requests) come first, then these skills.

## Red flags

| Thought | Reality |
| --- | --- |
| "The superpowers skill is right here" | It is blocked. Use the surf-roadmap one. |
| "I'll write the spec to a file, it's faster" | The hook blocks it, and nobody on the team will see it. Use write_spec. |
| "This is too small to plan" | Small systems get short interviews, not none. |
| "I'll update the roadmap at the end" | Update as you go: doing on start, post_update after each commit. |
```

- [ ] **Step 2: Write `setup`**

`plugin/skills/setup/SKILL.md`:

````markdown
---
name: setup
description: Set a repository up for the roadmap - check the API connection, link the repository to a roadmap project and board (surf-roadmap.json), resolve global worktree and subagent restrictions through two question trees, and write the surf conventions into CLAUDE.md and .gitignore. Use first in every repository, when surf-roadmap.json is missing, or when asked to set up, configure, bootstrap, link or initialise the roadmap or project conventions. Replaces surf-claude new-project.
argument-hint: "[path to the repository, defaults to the current directory]"
---

# surf-roadmap:setup

Runs once per repository, and again whenever the user wants to change the
answers. Interactive, in this order. Every mechanical step uses:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/surf-roadmap.mjs" <command> [flags]
```

The script prints JSON. Never type a convention out from memory; the script
writes what `${CLAUDE_PLUGIN_ROOT}/conventions/` defines.

## Step 1 — Connection

Run `whoami`. If `ok` is false, tell the user exactly what the error says and how
to fix it, then stop:

- missing variable: set `ROADMAP_URL` and `ROADMAP_API_KEY` (the app's account
  menu → API keys shows both lines), then restart Claude Code;
- 401: the key is wrong, expired or revoked; create a new one;
- unreachable: check the URL.

On success, remember `name` and `projects`.

## Step 2 — Project and board

Ask with the question tool, in one round:

1. **Which project does this repository belong to?** Options: each project from
   `whoami` (label `name`, description `slug · your role`), plus "Create a new project".
2. **Default board for new systems?** Only after the project is known: options from
   `get_project` (boards by name).

For a new project, ask for its name, slug and repository URL (suggest the `origin`
remote converted to https), then call `create_project`, and ask the board question.

If `surf-roadmap.json` already exists, show its values and ask whether to keep them.

## Step 3 — The worktree tree

Run `detect-global`. If `worktrees` is null, skip to Step 4 with worktrees `none`.
Otherwise show the found section verbatim, then ask:

**"Do you want to remove your global constraint on using worktrees?"**

- **Yes** → run `remove-global --kind worktrees`, show what was removed. Worktrees: `none`. Nothing more.
- **No** → ask **"Do you want to allow worktrees in the current repository?"**
  - Yes → worktrees `allowed` (the repository's CLAUDE.md then overrides the global rule here).
  - No → worktrees `forbidden`.

## Step 4 — The subagent tree

Same shape, for `subagents` from `detect-global`:

**"Do you want to remove your global constraint on using subagents and subagent-driven development?"**

- **Yes** → `remove-global --kind subagents`. Execution: `none`.
- **No** → **"Do you want to allow subagent-driven development in the current repository?"**
  - Yes → execution `subagent`.
  - No → execution `inline`.

If no global restriction exists, execution is `none`.

Removing a section edits the user's own `~/.claude/CLAUDE.md`; it is their answer
that authorises it, so never remove without a Yes in this conversation.

## Step 5 — Write

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/surf-roadmap.mjs" apply --repo <repo> --project <slug> --board <slug> --worktrees <allowed|forbidden|none> --execution <subagent|inline|none>
```

`apply` writes `surf-roadmap.json`, appends missing convention blocks to
`CLAUDE.md` (text outside the markers is never touched) and appends missing
`.gitignore` entries. If it reports `divergent` blocks, show the user which, and
ask whether to replace them; if yes, run `apply` again with `--update <ids>`.

## Step 6 — Other plugins

Check `claude plugin list` (or `~/.claude/settings.json` → `enabledPlugins`). If
`superpowers` or `surf` (surf-claude) is enabled, say in one sentence each: they
keep working in other repositories; in linked repositories surf-roadmap replaces
them and blocks the superpowers skills. Do not uninstall anything.

## Step 7 — Report

Report exactly: the link (project, board), CLAUDE.md blocks added/updated/left
divergent, .gitignore entries added, and what happened to the global constraints.
Do not commit; offer a `chore: Link repository to the roadmap` commit.
````

- [ ] **Step 3: Write `check-project`**

`plugin/skills/check-project/SKILL.md`:

````markdown
---
name: check-project
description: Audit a repository against the surf-roadmap conventions and propose exactly what to change, without changing anything until approved - link file, CLAUDE.md blocks, .gitignore, legacy spec, plan and ADR files that belong in the roadmap, commit messages. Use when asked to check, audit, migrate or modernise a repository, or when an old repository predates the roadmap. Never rewrites git history and never changes code behaviour. Replaces surf-claude check-project.
argument-hint: "[path to the repository, defaults to the current directory]"
---

# surf-roadmap:check-project

**Audit first, migration second.** Nothing is written before the report is shown
and the user has selected what to apply.

## Step 1 — Audit

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/surf-roadmap.mjs" audit --repo <repo>
```

## Step 2 — Report

Three buckets in order: **missing**, **divergent**, **conforming** (one line each).
Every missing or divergent finding states what was found and the exact change.

## Step 3 — Apply what the user selects

Ask with the question tool (multi-select), never all-or-nothing.

- `link`, `claude-md:*`, `gitignore:*` → run `/surf-roadmap:setup` steps 2–5 for
  just those (for divergent blocks, `apply --update <ids>`).
- `legacy:docs/adr` → for each ADR file, in number order: show it, ask whether to
  import; `create_adr` with its sections (keep its title; map Status accepted →
  `accept_adr`; superseded → import both, then `supersede_adr`). After all imports
  succeed and the user confirms, delete the folder in a `docs:` commit.
- `legacy:docs/plans`, `legacy:docs/specs`, `legacy:docs/superpowers` → for each
  file ask which system it belongs to (or create one with `create_system`), then
  `write_spec` or `write_plan`. Planning of an imported system is not complete;
  say so. Delete the files only after the user confirms.
- `commits:*` → report only. The fix is that the next commit conforms. Never offer
  to rebase, amend or force-push.

## Step 4 — Close

Re-run `audit` and show that the applied findings are gone. State what was left
and why. Running the skill twice produces no changes the second time.
````

- [ ] **Step 4: Write `plan-system`**

`plugin/skills/plan-system/SKILL.md`:

````markdown
---
name: plan-system
description: Mandatory, adversarial planning interview for every new system, feature, build or significant change BEFORE any spec, plan or code exists. Runs as many brutal question rounds as it takes, records every round and answer in the roadmap, names every way the idea can fail and makes the user answer or explicitly accept each risk, then writes the spec and completes planning with the user's own confirmation. Use whenever someone wants to build, add, change or design something, when a system sits in its planning column, or when /surf-roadmap:plan runs. Replaces superpowers:brainstorming.
argument-hint: "[the idea in one line, or an existing system slug]"
---

# surf-roadmap:plan-system

You are the most hostile reviewer this idea will ever meet. Your job is to make
sure nobody goes into a hundred revisions later, so every hole gets found **now**,
while fixing it costs one answer instead of one rewrite.

## Tone

- Savage about the plan. Mock hand-waving, "we'll figure it out", vague scope,
  magic numbers and missing edge cases. Profanity is allowed.
- Zero praise. Never "great idea", never "love it". Silence is the compliment.
- Attack the plan, never the person. No slurs, nothing about who they are.
- Every jab ends in a concrete question with real options. A roast without a
  question is noise.
- You never refuse to continue and never lecture. You keep asking until the gaps
  are closed.
- The spec you write at the end is neutral, precise and free of jokes.

Example of the register:

> "Players can trade items." Cool. What happens when two of them hit Accept in
> the same tick and one of them just dropped the item on the floor? Dupe city.
> Pick one: (A) server-side trade session with a lock per inventory, (B) escrow
> container both sides move items into, (C) you enjoy economy wipes.

## Hard rules

1. **No implementation.** No code, no scaffolding, no plan, no spec until the gate
   below passes. The roadmap server refuses to start tasks before that anyway.
2. **Record before you ask.** Every round goes to `add_planning_round` *before* you
   ask it, and every answer goes to `answer_planning_items` *right after*. The UI
   shows the interview to the whole team.
3. **Never answer for the user.** An item is answered only by the user's words. A
   dodge stays open. A flagged risk may be `accepted-risk` only when the user
   explicitly accepts it, and their reason is the answer.
4. **Rounds of at most four questions**, asked with the question tool, options
   with real trade-offs, your recommendation first and labelled. Ask as many
   rounds as it takes. There is no round limit and no "that's enough".
5. **Everything the user decides that meets the ADR criteria** (constrains future
   work, expensive to reverse, trades properties, security model, public API or
   format, new runtime dependency) becomes an ADR via `surf-roadmap:new-adr`
   before planning completes.

## Step 0 — Locate

1. Read `surf-roadmap.json` for `project` (and default `board`).
2. If the argument is an existing system slug, `get_system` and `get_planning`, and
   resume from the gaps. Otherwise ask for a title, slug and board if they are not
   obvious, and `create_system`.
3. Load context: `list_systems`, `list_adrs`, `list_questions`, and read the code
   the idea touches. Look for conflicts with existing systems and accepted ADRs.
   If the execution-mode block allows it, dispatch `surf-roadmap:red-team` with
   the idea and the context; it returns a list of attacks. You still ask.

## Step 1 — Rounds

Loop until the gate passes:

1. Pick the next up-to-four most dangerous unknowns, preferring areas with the
   fewest answered items and flagged risks.
2. `add_planning_round` with the items: `area` and `isRisk: true` for anything
   that is a way to fail.
3. Roast, then ask them with the question tool in one call.
4. `answer_planning_items` with the user's answers, verbatim or faithfully condensed.
   A vague answer is recorded, and its sharper follow-up goes into the next round.
5. After each round, say in one line what is still open.

### What you must attack, per area

- **failure-modes**: concurrency and races (same tick, double submit, two servers),
  bad and hostile input, abuse and exploits (dupes, bypasses, spam, permission
  escalation), crashes mid-operation and partial writes, data loss and rollback,
  restarts and reconnects, timeouts, clock issues, rate limits, what the user sees
  when it breaks.
- **dependencies**: which systems it touches or waits for, ordering between them,
  API contracts and formats, migrations of existing data, what breaks for others
  when this changes, external services.
- **scope**: the MVP cut, explicit non-goals, what "done" means as acceptance
  criteria someone can check, who uses it and how, edge-case policies.
- **ops-testing**: performance targets and load, configuration, permissions and
  roles, logging and metrics, how it is tested (unit, integration, load, manual),
  how it is rolled out and rolled back.

### ADRs during the interview

When an answer is a decision that meets the ADR criteria, say so, and run
`surf-roadmap:new-adr` for it (create it proposed, show it, accept it once the
user confirms). Link the system with `systems: [slug]`.

## Step 2 — The gate

Call `get_planning`. Continue asking while `gaps` lists anything except the missing
spec. When only the spec is missing:

1. Give a short, still-savage summary of the risks the user accepted.
2. Write the spec and save it with `write_spec`:

   ```markdown
   # <System title>

   ## Goal
   ## Out of scope
   ## Users and flows
   ## Design
   ## Data and interfaces
   ## Failure modes and how each is handled
   ## Dependencies and ordering
   ## Operations and testing (acceptance criteria)
   ## Accepted risks (with the user's reasons)
   ## Decisions (ADR numbers)
   ```

   Every answered item appears in the spec where it belongs. Nothing in the spec
   was not decided by the user.
3. Show the spec (or its link on the system page) and ask the user to confirm it
   **in their own words**. A bare "ok" gets one follow-up: "Say what you're
   confirming." Changes go back into the spec (`write_spec` again) or into a new
   round.
4. `complete_planning` with `userConfirmation` set to the user's words, verbatim.
   If the server lists gaps, go back to Step 1.

## Step 3 — Hand off

Say that planning is complete and the next step is `/surf-roadmap:write-plan`.
Do not start it unless the user asks.
````

- [ ] **Step 5: Write `new-adr`, `open-question` and `track-work`**

`plugin/skills/new-adr/SKILL.md`:

```markdown
---
name: new-adr
description: Record a decision the user has actually made as an ADR in the roadmap, or supersede an accepted one. Use after any decision that constrains future work, is expensive to reverse, trades one property against another, affects the security model, changes a public API or a wire or on-disk format, or adds a runtime dependency. Refuses to record decisions that were not made, enforces one decision per record, demands honest alternatives and real costs. Replaces surf-claude new-adr.
argument-hint: "[the decision, in one line]"
---

# surf-roadmap:new-adr

An ADR is the decision, not a report about a conversation. The roadmap numbers it.
Delegating the writing to the `surf-roadmap:adr-writer` subagent is fine when
subagents are allowed; the checks below still happen in the main session.

## Refuse before writing

Check all four. If one fails, say which and stop.

1. **The decision has been made**: the user chose between named options. If not,
   present the options and trade-offs and ask. Your preference is not a decision.
2. **It is one decision.** If the title needs "and", it is two ADRs; ask which first.
3. **It needed a human.** No lasting consequence and no real alternative → no ADR.
4. **Every section can be filled honestly.**

## Write it

`create_adr` with `project`, `title`, and all four sections:

- **context** — what forced a decision, readable by someone who was not there. No
  "the user asked".
- **decision** — present tense, as a rule the project now follows.
- **alternatives** — only real ones; each states its real advantage first, then
  what disqualified it.
- **consequences** — what it gives, what it costs, follow-on work, and what it
  forecloses (and what a reversal would cost). Benefits only → rewrite.

Pass `systems` with the slugs it concerns. Show the created ADR and ask the user
to confirm the text; then `accept_adr`. Accepted ADRs are immutable.

## Superseding

Write the new ADR (its context says what changed), accept it, then
`supersede_adr` with `number` = old and `by` = new. Never edit the old one.
```

`plugin/skills/open-question/SKILL.md`:

```markdown
---
name: open-question
description: Record something that cannot be decided now as an open question in the roadmap, tied to a system when it concerns one, and resolve it when answered. Use when blocked on a human decision, when an answer is needed from someone who is not here, or when a planning interview surfaces a question outside the current system.
argument-hint: "[the question]"
---

# surf-roadmap:open-question

1. Phrase it as a question someone can answer without context: what is unclear,
   why it matters, the options you see.
2. `add_question` with `project`, `title` (the question), `text` (context and
   options) and `system` when it concerns one.
3. If it blocks a task, set that task `blocked` with `update_task` and say so in a
   `post_update`.
4. When answered, `answer_question` with the answer (resolves it), and continue.
   If the answer is a decision that needs a human, also run `surf-roadmap:new-adr`.
```

`plugin/skills/track-work/SKILL.md`:

```markdown
---
name: track-work
description: Keep the roadmap current while working so the team sees what is happening - find the system and task, set the task doing when starting (which makes you owner), post a progress update with the commit hash after every commit, mark tasks done and move the system to review or done when finished, and raise blockers as questions. Use at the start of any work in a linked repository, after every commit, when finishing a task, and when blocked.
---

# surf-roadmap:track-work

## Start

1. `list_systems` (filter by board or category) or `get_system` to find the system.
   Planning incomplete? Stop and run `surf-roadmap:plan-system`.
2. Pick the task (`get_system` shows ids). `update_task` with `state: "doing"`. This
   makes the key's user the owner of the task and of the system if they had none.
3. If the system is not in an active column, `move_system` to it.

## After every commit

`post_update` with `system`, `summary` (what changed, short markdown), `taskId`,
`commit` (the hash, even unpushed) and `nextStep`.

## Finish

`update_task` `done` for each finished task. When all are done, `move_system` to a
review column (or done if there is no review), and post a closing update.

## Blocked

`update_task` `blocked`, `surf-roadmap:open-question` for what blocks it, and a
`post_update` saying what you tried.

Always pass `agent` with your name on writes.
```

- [ ] **Step 6: Commit**

```bash
git add plugin/skills
git commit -m "feat(plugin): Add setup, audit, planning interview, ADR, question and tracking skills"
```

---

### Task 7.5: Forked superpowers skills

**Files:**
- Create: `plugin/skills/<name>/` for the twelve forks below (copied directories, then edited)

**Source:** `/c/Users/hombe/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/` (use the version found in Task 7.1 Step 2).

| Source skill | Target skill |
| --- | --- |
| `writing-plans` | `write-plan` |
| `executing-plans` | `execute-plan` |
| `subagent-driven-development` | `subagent-driven-development` |
| `dispatching-parallel-agents` | `dispatching-parallel-agents` |
| `using-git-worktrees` | `using-git-worktrees` |
| `test-driven-development` | `test-driven-development` |
| `systematic-debugging` | `systematic-debugging` |
| `verification-before-completion` | `verification-before-completion` |
| `requesting-code-review` | `requesting-code-review` |
| `receiving-code-review` | `receiving-code-review` |
| `finishing-a-development-branch` | `finishing-a-development-branch` |
| `writing-skills` | `writing-skills` |

- [ ] **Step 1: Copy the directories and rewrite references**

```bash
SP=/c/Users/hombe/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills
cd plugin/skills
for pair in writing-plans:write-plan executing-plans:execute-plan subagent-driven-development:subagent-driven-development \
  dispatching-parallel-agents:dispatching-parallel-agents using-git-worktrees:using-git-worktrees \
  test-driven-development:test-driven-development systematic-debugging:systematic-debugging \
  verification-before-completion:verification-before-completion requesting-code-review:requesting-code-review \
  receiving-code-review:receiving-code-review finishing-a-development-branch:finishing-a-development-branch writing-skills:writing-skills; do
  src=${pair%%:*}; dst=${pair##*:}
  rm -rf "$dst"; cp -r "$SP/$src" "$dst"
done
grep -rl "superpowers" . | while read -r file; do
  sed -i \
    -e 's/superpowers:brainstorming/surf-roadmap:plan-system/g' \
    -e 's/superpowers:writing-plans/surf-roadmap:write-plan/g' \
    -e 's/superpowers:executing-plans/surf-roadmap:execute-plan/g' \
    -e 's/superpowers:using-superpowers/surf-roadmap:using-surf-roadmap/g' \
    -e 's/superpowers:/surf-roadmap:/g' \
    "$file"
done
sed -i -e 's/^name: writing-plans$/name: write-plan/' write-plan/SKILL.md
sed -i -e 's/^name: executing-plans$/name: execute-plan/' execute-plan/SKILL.md
cd ../..
grep -rn "superpowers" plugin/skills | grep -v "Adapted from superpowers" || echo "no stray superpowers references"
grep -rn "docs/superpowers" plugin/skills
```

Expected: the first grep lists only lines you must still handle in Step 3 (paths such as `docs/superpowers/plans`); `name:` lines of the two renamed skills match their directory.

- [ ] **Step 2: Insert the notice and the roadmap integration section**

In every forked `SKILL.md`, directly below the first `# ` heading, insert:

```markdown
> Adapted from superpowers 6.4.1 by Jesse Vincent (MIT, see `LICENSES/superpowers-MIT.txt`) for the surf-roadmap workflow. The **Roadmap integration** section overrides anything below it that conflicts.

## Roadmap integration
```

followed by the skill's integration text from this list (verbatim):

- **write-plan**:
  - Preconditions, all checked with `get_system`, stated and stopped on if any fails: `planning.complete` is true (otherwise run `surf-roadmap:plan-system`); no unresolved question tied to the system; every decision in the spec that meets the ADR criteria has an accepted ADR (otherwise `surf-roadmap:new-adr`).
  - The plan is never saved as a file. Save it with `write_plan`: `body` is the whole plan markdown, `steps` lists every task as `{ step, title }` with the same numbers as the plan's `### Task N` headings. Each new step becomes a roadmap task; report `missingSteps` if a rewrite dropped steps.
  - The plan's header names the spec as "the spec of system `<slug>` in project `<project>` (get_system)" instead of a file path.
  - Besides the sections below, every plan contains: **Goal** as an observable end state; **Out of scope** (never empty); per task **Ends in** (observable state), **Verified by** (exact command) and **Pushes** (`no`, or `yes` with why CI output is needed); a final **Verification** task; **Push points** (or `none`); **Risk** (the step most likely to go wrong and what the agent does then); and the sentence "If reality contradicts this plan, the agent stops and asks; it does not silently rewrite the plan."
  - The execution handoff offers `surf-roadmap:subagent-driven-development` or `surf-roadmap:execute-plan`, respecting the execution-mode block of CLAUDE.md (if it says inline, only offer inline).
- **execute-plan**:
  - Load the plan with `get_document` (`kind: "plan"`) and the tasks with `get_system`; never look for a plan file.
  - Before each task: `update_task` `doing` (this assigns you as owner). After each commit: `post_update` with `taskId` and `commit`. After the task's verification passes: `update_task` `done`.
  - Blocked: `update_task` `blocked`, `surf-roadmap:open-question`, stop and ask.
  - When all tasks are done: `move_system` to a review column, then `surf-roadmap:finishing-a-development-branch`.
- **subagent-driven-development**:
  - Only when CLAUDE.md's execution-mode block says subagent (or there is no block and the user chose it). If the block says inline, use `surf-roadmap:execute-plan` instead.
  - Load plan and tasks from the roadmap as in execute-plan. Dispatch `surf-roadmap:implementer` for each task, then `surf-roadmap:spec-reviewer`, then `surf-roadmap:code-reviewer`; for the final whole-branch review use `surf-roadmap:deep-reviewer`. Where the text below dispatches a general-purpose subagent with a prompt template, dispatch the named agent with that prompt.
  - Every subagent prompt includes: the project slug, the system slug, the task id and title, the rule "Every CLAUDE.md rule applies to you; never decide something that needs a human — stop and report the question", and the tracking rule (implementer: `update_task` doing on start, `post_update` after each commit; reviewers: read-only).
  - The controller sets the task `done` only after both reviews pass.
- **dispatching-parallel-agents**: only when the execution-mode block allows subagents; read-only helpers (`surf-roadmap:explorer`, `surf-roadmap:red-team`) are always allowed. Parallel agents working on tasks each set their task `doing` and post their own updates.
- **using-git-worktrees**: before creating a worktree, read CLAUDE.md's worktrees block. `forbidden` → do not create one; ask the user. `allowed` → create under `.worktrees/`. No block → ask the user. Never create a worktree on your own initiative otherwise.
- **test-driven-development**: the method below applies unchanged. When a test reveals that the spec is wrong or incomplete, stop and raise it with `surf-roadmap:open-question` instead of changing the spec yourself.
- **systematic-debugging**: when the root cause cannot be fixed within the current task, set the task `blocked` and record the finding with `surf-roadmap:open-question`; post the evidence in a `post_update`.
- **verification-before-completion**: the verification evidence (command and result) goes into the `post_update` for the task before it is marked `done`.
- **requesting-code-review**: dispatch `surf-roadmap:code-reviewer` for routine reviews and `surf-roadmap:deep-reviewer` for final or whole-branch reviews, and `surf-roadmap:security-reviewer` when the change touches auth, permissions, input handling or secrets. The review scope is the task list from `get_system` plus the diff.
- **receiving-code-review**: the method below applies unchanged. Accepted review findings that change behaviour are tasks: `add_task` on the system.
- **finishing-a-development-branch**: before presenting options, every task of the system is `done` or explicitly left with the user's agreement; the system is moved to a review or done column with `move_system`; a closing `post_update` summarises the branch. Pushing follows the commits block of CLAUDE.md (never without a human's word or a plan step that pushes).
- **writing-skills**: skills for this workflow live in the `surf-roadmap` plugin; name them without the `superpowers` prefix and never reference `docs/superpowers` paths.

- [ ] **Step 3: Remove file-path instructions that conflict**

Search each fork for instructions to save to or read from `docs/superpowers/...`, `docs/plans`, or `docs/specs`:

```bash
grep -rn "docs/superpowers\|docs/plans\|docs/specs\|\.md\` and commit\|Save plans to" plugin/skills
```

Replace each hit with the roadmap equivalent (for example "Save plans to: `docs/superpowers/plans/…`" becomes "Save the plan with `write_plan` (see Roadmap integration)"; "the spec file" becomes "the system's spec (`get_document` with `kind: "spec"`)"). Keep the rest of the method text unchanged.

Expected afterwards: the grep prints nothing.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills
git commit -m "feat(plugin): Fork the superpowers skills with roadmap integration"
```

---

### Task 7.6: Commands

**Files:**
- Create: `plugin/commands/plan.md`, `plugin/commands/status.md`, `plugin/commands/next.md`

- [ ] **Step 1: Write the commands**

`plugin/commands/plan.md`:

```markdown
---
description: Plan a new system (or resume one) with the adversarial planning interview
argument-hint: "<idea in one line | system slug>"
---

Invoke the `surf-roadmap:plan-system` skill for: $ARGUMENTS

If no argument was given, ask what should be planned first.
```

`plugin/commands/status.md`:

```markdown
---
description: Show the linked roadmap project's active, blocked and planning systems
---

Read `surf-roadmap.json` for the project. Call `list_systems` for the project and
show, grouped by column category in this order: active, blocked, review, planning
(with how many planning items are still open from `get_system` for at most five of
them), then a count of todo and done. For each system: title, board, column, owner,
tasks done/total. End with the three newest `list_updates` entries. Do not change anything.
```

`plugin/commands/next.md`:

```markdown
---
description: Propose the next task to work on, then ask before starting it
---

Read `surf-roadmap.json` for the project and default board. Using `list_phases`,
`list_systems` and `get_system`, find candidate tasks: state `todo`, system planning
complete, system in an earlier or current phase whose dependencies are done, highest
priority first (MVP, Later, Nice to have), unowned or owned by the current user
(`whoami`). Propose the top three with one line of reasoning each and ask which to
start with the question tool. Only after the user chooses, follow
`surf-roadmap:track-work` to start it.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/commands
git commit -m "feat(plugin): Add plan, status and next commands"
```

---

### Task 7.7: Subagents pinned to models

**Files:**
- Create: 13 files in `plugin/agents/`

Every agent file follows this shape (frontmatter first line `---`). Read-only agents use `disallowedTools: Write, Edit, MultiEdit, NotebookEdit` and are told never to call roadmap write tools. Each body starts with the shared rules block below, then the agent's own instructions.

Shared rules block (copy into every agent body):

```markdown
Rules: Every rule in the repository's CLAUDE.md applies to you in full. You never
decide something that needs a human: stop and report the question to your parent.
Report what you did and what you could not do; never report success for something
you worked around. The roadmap project slug is in `surf-roadmap.json`.
```

- [ ] **Step 1: Write the agents**

`plugin/agents/implementer.md`:

```markdown
---
name: implementer
description: Implements exactly one task of a roadmap plan with test-driven development, commits, and keeps the task and progress current in the roadmap. Dispatched by surf-roadmap:subagent-driven-development with the project, system, task id and the task text.
model: sonnet
effort: medium
---

(shared rules block)

1. `update_task` the given task to `doing` before touching code.
2. Follow `surf-roadmap:test-driven-development`: failing test, see it fail, minimal
   code, see it pass, refactor.
3. Commit per the commits block (one coherent change, Conventional Commits, no
   attribution). After each commit `post_update` with `taskId` and `commit`.
4. Do only this task. If the task text is ambiguous, contradicts the code, or needs
   a decision, stop and report instead of guessing.
5. Report: files changed, tests run with their output, commits, anything left open.
   Do not mark the task done; the controller does after review.
```

`plugin/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: Routine review of a diff for bugs, quality and the repository conventions (doc comments, commit format, tests). Read-only. Use after each implemented task.
model: sonnet
effort: medium
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

Review the diff you are given (or `git diff <base>...HEAD`). Report findings ranked
most severe first, each with file:line, the defect, a concrete failing scenario and
the fix. Check: correctness and edge cases, tests actually exercising the change,
doc comments on every function describing what it does (never history or
rationale), Conventional Commits without attribution. Say "no findings" when there
are none. Never call roadmap write tools.
```

`plugin/agents/deep-reviewer.md`:

```markdown
---
name: deep-reviewer
description: In-depth final review of a whole branch or large change - correctness, design, cross-file consistency, failure modes, tests and conventions. Read-only. Use before finishing a branch.
model: opus
effort: medium
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

Review the whole branch (`git diff <base>...HEAD`) against the system's spec and
plan (`get_system`, `get_document`). Look for bugs, races, error handling gaps,
inconsistent names or types across files, missing tests for the spec's failure
modes, and convention breaks. Rank findings most severe first with file:line, a
failing scenario and the fix. Never call roadmap write tools.
```

`plugin/agents/spec-reviewer.md`:

```markdown
---
name: spec-reviewer
description: Checks an implementation against the system's spec and the plan task in the roadmap; reports missing requirements and over-building. Read-only. Use after each implemented task, before code review.
model: opus
effort: medium
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

Load the spec and plan with `get_document` and the task with `get_system`. Compare
the diff with the task and the spec sections it implements. Report: requirements
the task needed that are missing, behaviour that contradicts the spec, and anything
built that the task did not ask for. Quote the spec line for each finding. Never
call roadmap write tools.
```

`plugin/agents/security-reviewer.md`:

```markdown
---
name: security-reviewer
description: Security review of a change - authentication, authorisation and permission checks, injection, secrets, input validation, exploit paths (dupes, bypasses, escalation). Read-only. Use for changes touching auth, permissions, input handling, economy or secrets.
model: opus
effort: high
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

For the diff you are given, find every way an attacker or a malicious client could
abuse it: missing server-side checks, trusting client data, injection, secrets in
code or logs, race-based dupes and bypasses, privilege escalation. For each, give
the exploit scenario step by step at the level needed to understand the fix, the
fix, and severity. Never call roadmap write tools.
```

`plugin/agents/red-team.md`:

```markdown
---
name: red-team
description: Feeds the planning interview - given a draft idea and the project's existing systems, ADRs and questions, lists every failure mode, conflict, dependency and scope hole worth asking about, grouped by planning area. Read-only. Used by surf-roadmap:plan-system.
model: sonnet
effort: high
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

Read the idea, then `list_systems`, `list_adrs`, `list_questions` and the code it
touches. Return a list grouped by area (failure-modes, dependencies, scope,
ops-testing). Each entry: the attack in one sentence, why it matters, and two or
three concrete options the user could choose between. Mark entries that are ways
to fail as risks. Include conflicts with accepted ADRs and overlapping systems.
Do not ask the user anything and never call roadmap write tools; the main session asks.
```

`plugin/agents/plan-checker.md`:

```markdown
---
name: plan-checker
description: Checks a roadmap plan before execution - unverifiable steps, missing out-of-scope or risk sections, steps without an exact verification command, decisions without an accepted ADR, push points without a reason. Read-only.
model: sonnet
effort: medium
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

Load the plan (`get_document` kind plan), the spec, ADRs (`list_adrs`) and tasks
(`get_system`). Report every step whose end state cannot be observed, every step
without an exact command or observation under "Verified by", a missing Goal, Out
of scope, Verification task, Push points or Risk section, plan steps without a
matching task or tasks without a step, and spec decisions meeting the ADR criteria
that have no accepted ADR. Never call roadmap write tools.
```

`plugin/agents/debugger.md`:

```markdown
---
name: debugger
description: Systematic root-cause investigation of a failing test, bug or unexpected behaviour, following surf-roadmap:systematic-debugging; fixes it when the fix is inside the current task, otherwise reports and raises a question.
model: sonnet
effort: high
---

(shared rules block)

Follow `surf-roadmap:systematic-debugging`: reproduce, gather evidence, form one
hypothesis at a time, test it, find the root cause before changing code. If the fix
belongs to the current task, write the failing test first, fix, verify, commit and
`post_update`. If not, report the root cause with evidence and recommend an
`add_question`; do not change unrelated code.
```

`plugin/agents/test-writer.md`:

```markdown
---
name: test-writer
description: Adds or strengthens tests for an existing change without touching production code - edge cases, failure modes from the spec, regression tests.
model: sonnet
effort: medium
---

(shared rules block)

Read the change, the spec's failure modes and the existing tests. Add tests that
pin behaviour the change must have, especially the failure modes and edge cases
the spec lists. Never edit production code; if a test fails because the code is
wrong, report it with the failing output. Commit the tests (`test:` type).
```

`plugin/agents/adr-writer.md`:

```markdown
---
name: adr-writer
description: Writes a decision the user has already made as a complete ADR in the roadmap with create_adr - honest alternatives with their real advantages, consequences with costs, follow-on work and what is foreclosed. Used by surf-roadmap:new-adr.
model: haiku
effort: medium
---

(shared rules block)

You receive the decision, the options that were on the table with their trade-offs,
and the systems it concerns. Call `create_adr` once with title, context, decision,
alternatives and consequences exactly as `surf-roadmap:new-adr` describes. Do not
accept it; return the ADR number and the text for the parent to show the user. If
any section cannot be filled honestly from what you were given, do not create the
ADR and report which section and why.
```

`plugin/agents/explorer.md`:

```markdown
---
name: explorer
description: Read-only codebase search that returns conclusions, not file dumps - where something lives, how a flow works, which files a change touches.
model: haiku
effort: low
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
---

(shared rules block)

Answer the question you are given by searching the codebase. Return the answer in a
few sentences with `path:line` references for each claim. Do not paste whole files.
If you could not find something, say where you looked.
```

`plugin/agents/doc-commenter.md`:

```markdown
---
name: doc-commenter
description: Adds missing doc comments per the repository convention (what the code does, never how it came to exist), one file per batch.
model: haiku
effort: medium
---

(shared rules block)

For the file you are given, add a doc comment to every function, class, interface
and public property that lacks one, in the language's form. Describe what the code
does, its parameters and return value. Never mention ADRs, plans, conversations,
change history or design rationale. If you cannot tell what something does without
knowing intent that is not in the code, list it instead of guessing. Change nothing
but comments.
```

`plugin/agents/progress-reporter.md`:

```markdown
---
name: progress-reporter
description: Summarises the commits since the last progress update of a system into one post_update with the newest commit hash and a next step.
model: haiku
effort: low
---

(shared rules block)

`list_updates` for the system to find the last reported commit. Read
`git log --format="%h %s" <last>..HEAD` (or the last 10 commits when none is
reported). Write one `post_update`: a short markdown summary of what changed, the
newest commit hash, the task id if one task dominates, and the next step if the
commits or plan make it clear. Return the update's id.
```

Replace every `(shared rules block)` line with the shared rules block text.

- [ ] **Step 2: Commit**

```bash
git add plugin/agents
git commit -m "feat(plugin): Add model-pinned subagents"
```

---

### Task 7.8: Validate and try the plugin end to end

- [ ] **Step 1: Validate**

```bash
npm run test:plugin
claude plugin validate ./plugin
claude plugin validate .
```

Expected: tests pass; both validations report `Validation passed` (warnings must be read and fixed unless they only concern optional metadata).

- [ ] **Step 2: Install locally and exercise it in a scratch repository**

```bash
claude plugin marketplace add "$(pwd)"
claude plugin install surf-roadmap@surf-roadmap
mkdir -p /tmp/roadmap-try && cd /tmp/roadmap-try && git init -q
```

With the dev server from Part 5 running and `ROADMAP_URL`/`ROADMAP_API_KEY` exported, start `claude` in `/tmp/roadmap-try` and check, recording each result:

1. `/surf-roadmap:setup` links the repository to a project, asks the worktree and subagent trees (only if the global CLAUDE.md has restrictions), and writes `surf-roadmap.json`, `CLAUDE.md` and `.gitignore`.
2. A new session shows the roadmap context; asking Claude to "use superpowers:brainstorming" is denied with the replacement named.
3. Asking Claude to write `docs/specs/x.md` is denied, naming `write_spec`.
4. `/surf-roadmap:plan a trading system` starts rounds that appear live in the app's Planning accordion.
5. `/agents` lists the thirteen `surf-roadmap:*` agents with their models.

Fix anything that fails before committing.

- [ ] **Step 3: Commit fixes, if any**

```bash
git add -A
git commit -m "fix(plugin): Address issues found in the end-to-end check"
```

(Skip when nothing changed.)
