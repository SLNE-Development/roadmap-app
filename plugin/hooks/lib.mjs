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
  let rel = relative(root, absolute).split(sep).join("/").replace(/\\/g, "/");
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
  if (process.platform === "win32") rel = rel.toLowerCase();
  for (const [dir, tool] of BLOCKED_DOC_DIRS) {
    if (`${rel}/`.startsWith(dir)) {
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
