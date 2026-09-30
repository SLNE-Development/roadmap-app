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

/** Prints a JSON result synchronously and exits with `code`. */
function done(result, code = 0) {
  writeFileSync(1, `${JSON.stringify(result, null, 2)}\n`);
  process.exit(code);
}

/** Reads a text file, or returns an empty string when it does not exist. */
function readOr(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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
    if (claude.added.length || claude.updated.length) writeFileSync(claudePath, claude.content);
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
