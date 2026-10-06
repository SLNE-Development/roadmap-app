#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditRepo, detectRestrictions, expectedBlocks, loadConventions, planClaudeMd, planGitignore, removeSection, renderOtherAgents } from "./lib.mjs";

/** Raised for invalid input; its message is reported to the caller as the error. */
class UsageError extends Error {}

/** Accepted values of the setup answers. */
const CHOICES = { worktrees: ["allowed", "forbidden", "none"], execution: ["subagent", "inline", "none"] };

/** Accepted values of `--targets` for the other-agents command. */
const TARGETS = ["agents", "cursor"];

/** Parses `--name value` flags into an object; a flag without a value or a stray argument is an error. */
function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new UsageError(`Unexpected argument ${argv[i]}.`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${argv[i]} needs a value.`);
    out[argv[i].slice(2)] = value;
    i++;
  }
  return out;
}

/** Prints a JSON result synchronously and exits with `code`. */
function done(result, code = 0) {
  writeFileSync(1, `${JSON.stringify(result, null, 2)}\n`);
  process.exit(code);
}

/** Reads a text file, or returns an empty string when it does not exist. */
function readOr(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Returns the git top level of the working directory, or the working directory outside git. */
function defaultRepo() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

/** Resolves the `--repo` flag (default: git top level) and checks that it is a directory. */
function repoOf(f) {
  const repo = f.repo ?? defaultRepo();
  if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new UsageError(`${repo} is not a directory.`);
  return repo;
}

/** Validates a setup answer flag against its allowed values. */
function choice(f, name) {
  const value = f[name] ?? "none";
  if (!CHOICES[name].includes(value)) throw new UsageError(`--${name} must be one of ${CHOICES[name].join(", ")}.`);
  return value;
}

/** Returns recent commits of `repo` as `{ subject, body }`, or an empty list outside git. */
function gitLog(repo) {
  try {
    const raw = execFileSync("git", ["-C", repo, "log", "-40", "--format=%s%x1f%b%x1e"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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

/** Reads the existing link file as an object; an unreadable or non-object file is an error so it is never overwritten. */
function readLink(path) {
  if (!existsSync(path)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new UsageError(`${path} is not valid JSON; fix or remove it first.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new UsageError(`${path} is not a JSON object.`);
  return parsed;
}

/** Runs the requested command and prints its JSON result. */
async function main() {
  const conv = loadConventions(fileURLToPath(new URL("../conventions/", import.meta.url)));
  const [command, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const globalFile = f.file ?? join(homedir(), ".claude", "CLAUDE.md");

  switch (command) {
    case "detect-global": {
      const found = detectRestrictions(readOr(globalFile));
      const view = (s) => (s ? { heading: s.heading, text: s.text } : null);
      done({ file: globalFile, worktrees: view(found.worktrees), subagents: view(found.subagents) });
      break;
    }
    case "remove-global": {
      const kind = f.kind;
      if (kind !== "worktrees" && kind !== "subagents") throw new UsageError("--kind must be worktrees or subagents.");
      const text = readOr(globalFile);
      const found = detectRestrictions(text);
      const section = found[kind];
      if (!section) done({ ok: true, removed: null });
      const other = kind === "worktrees" ? "subagents" : "worktrees";
      writeFileSync(globalFile, removeSection(text, section));
      done({ ok: true, file: globalFile, removed: section.text, ...(found[other] === section ? { alsoCovers: other } : {}) });
      break;
    }
    case "apply": {
      const repo = repoOf(f);
      if (!f.project) throw new UsageError("--project is required.");
      const answers = { worktrees: choice(f, "worktrees"), execution: choice(f, "execution") };
      const linkPath = join(repo, "surf-roadmap.json");
      const link = { ...readLink(linkPath), project: f.project, ...(f.board ? { board: f.board } : {}) };
      writeFileSync(linkPath, `${JSON.stringify(link, null, 2)}\n`);
      const claudePath = join(repo, "CLAUDE.md");
      const claude = planClaudeMd(readOr(claudePath), expectedBlocks(conv, answers), (f.update ?? "").split(",").filter(Boolean));
      if (claude.added.length || claude.updated.length) writeFileSync(claudePath, claude.content);
      const entries = conv.manifest.gitignore.filter((g) => g.always || (g.when && answers.worktrees === g.when.worktrees)).map((g) => g.entry);
      const ignorePath = join(repo, ".gitignore");
      const ignore = planGitignore(readOr(ignorePath), entries);
      if (ignore.added.length) writeFileSync(ignorePath, ignore.content);
      done({ ok: true, link, claudeMd: { added: claude.added, updated: claude.updated, divergent: claude.divergent, problems: claude.problems }, gitignore: ignore.added });
      break;
    }
    case "other-agents": {
      const repo = repoOf(f);
      const targets = (f.targets ?? "").split(",").filter(Boolean);
      if (!targets.length) throw new UsageError(`--targets is required (${TARGETS.join(", ")}).`);
      const unknown = targets.find((t) => !TARGETS.includes(t));
      if (unknown) throw new UsageError(`Unknown target ${unknown}; use ${TARGETS.join(", ")}.`);
      const answers = { worktrees: choice(f, "worktrees"), execution: choice(f, "execution") };
      const rendered = renderOtherAgents(conv, answers, readLink(join(repo, "surf-roadmap.json")));
      const written = [];
      if (targets.includes("agents")) {
        const path = join(repo, "AGENTS.md");
        const plan = planClaudeMd(readOr(path), rendered.blocks, rendered.blocks.map((b) => b.id));
        if (plan.added.length || plan.updated.length) writeFileSync(path, plan.content);
        written.push(path);
      }
      if (targets.includes("cursor")) {
        const path = join(repo, ".cursor", "rules", "surf-roadmap.mdc");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, rendered.cursorRule);
        written.push(path);
      }
      done({ ok: true, written });
      break;
    }
    case "audit": {
      const repo = repoOf(f);
      const order = { missing: 0, divergent: 1, conforming: 2 };
      done({ findings: auditRepo(repo, conv, gitLog(repo)).sort((a, b) => order[a.kind] - order[b.kind]) });
      break;
    }
    default:
      throw new UsageError("usage: surf-roadmap.mjs <detect-global|remove-global|apply|other-agents|audit> [flags]");
  }
}

try {
  await main();
} catch (error) {
  done({ ok: false, error: error instanceof Error ? error.message : String(error) }, 1);
}
