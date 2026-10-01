import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Words that turn a section about worktrees or subagents into a restriction. */
const RESTRICTIVE = /\b(never|don't|do not|must not|forbid\w*|not permitted|not allowed|only .{0,40}when .{0,40}ask)\b/i;

/** Topic patterns of the two restrictions setup asks about. */
const TOPICS = {
  worktrees: /worktree/i,
  subagents: /\b(subagents?|agent tool|subagent-driven|delegat\w+)\b/i,
};

/** Returns the line ending `text` uses: CRLF when it contains one, otherwise LF. */
function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Splits markdown into heading sections. A section runs from its heading to the
 * next heading of the same or a higher level. Lines keep any trailing carriage
 * return so sections can be cut out of CRLF files without touching other lines.
 *
 * @return sections with 0-based `start` (heading line) and exclusive `end` line indexes
 */
export function findSections(md) {
  const lines = md.split("\n");
  const headings = [];
  let fence = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) headings.push({ start: i, level: m[1].length, heading: m[2].trim() });
  });
  return headings.map((h, idx) => {
    const next = headings.slice(idx + 1).find((n) => n.level <= h.level);
    const end = next ? next.start : lines.length;
    return { ...h, end, text: lines.slice(h.start, end).join("\n").replace(/\r/g, "") };
  });
}

/**
 * Finds the sections of a global CLAUDE.md that forbid worktrees or subagents, if
 * any. The innermost matching section wins, so a parent heading that merely
 * contains a matching child is never reported. A section matching both topics is
 * reported for both.
 */
export function detectRestrictions(md) {
  const sections = findSections(md);
  const pick = (topic) => {
    const matches = sections.filter((s) => TOPICS[topic].test(s.text) && RESTRICTIVE.test(s.text));
    const innermost = matches.filter((s) => !matches.some((o) => o !== s && o.start >= s.start && o.end <= s.end));
    return innermost[0] ?? null;
  };
  return { worktrees: pick("worktrees"), subagents: pick("subagents") };
}

/**
 * Returns `md` without `section`. Only the blank lines directly around the cut
 * are collapsed; the rest of the file is left byte for byte as it was.
 */
export function removeSection(md, section) {
  const lines = md.split("\n");
  lines.splice(section.start, section.end - section.start);
  const blank = (i) => i >= 0 && i < lines.length && lines[i].trim() === "";
  while (section.start < lines.length && blank(section.start) && blank(section.start - 1)) lines.splice(section.start, 1);
  if (section.start >= lines.length) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length) lines.push("");
  }
  return lines.join("\n");
}

/** Wraps a block body in the surf-roadmap markers. */
export function renderBlock(id, text, variant) {
  const v = variant ? ` variant=${variant}` : "";
  return `<!-- surf-roadmap:block id=${id}${v} v=1 -->\n${text.trim()}\n<!-- surf-roadmap:end id=${id} -->`;
}

const START_MARKER = /^<!-- surf-roadmap:block id=([a-z-]+)(?: variant=([a-z]+))? v=\d+ -->\s*$/;
const END_MARKER = /^<!-- surf-roadmap:end id=([a-z-]+) -->\s*$/;

/**
 * Scans a CLAUDE.md for marked blocks. Markers must sit on their own line and are
 * ignored inside code fences. A block body never contains another start marker.
 * Start markers without an end (`unterminated`), end markers without a start
 * (`orphan-end`) and ids defined twice (`duplicate`) are reported as problems and
 * never as blocks, so callers can leave those ids alone.
 *
 * @return `blocks` by id with variant, body and character range, and `problems`
 */
export function scanBlocks(md) {
  const blocks = new Map();
  const problems = [];
  let offset = 0;
  let fence = false;
  let open = null;
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const lineStart = offset;
    offset += raw.length + 1;
    if (/^```/.test(line)) fence = !fence;
    const start = !fence && START_MARKER.exec(line);
    const end = !fence && END_MARKER.exec(line);
    if (start) {
      if (open) problems.push({ id: open.id, kind: "unterminated" });
      open = { id: start[1], variant: start[2] ?? null, start: lineStart, body: [] };
    } else if (end) {
      if (open && open.id === end[1]) {
        if (blocks.has(open.id)) problems.push({ id: open.id, kind: "duplicate" });
        else blocks.set(open.id, { variant: open.variant, text: open.body.join("\n").trim(), start: open.start, end: lineStart + line.length });
        open = null;
      } else {
        problems.push({ id: end[1], kind: "orphan-end" });
      }
    } else if (open) {
      open.body.push(line);
    }
  }
  if (open) problems.push({ id: open.id, kind: "unterminated" });
  return { blocks, problems };
}

/** Parses every well-formed marked block of a CLAUDE.md by id, with its variant, body and character range. */
export function parseBlocks(md) {
  return scanBlocks(md).blocks;
}

/** Loads the conventions directory: the manifest plus the text of every block file. */
export function loadConventions(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const read = (file) => readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
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
 * `update`. Text outside the markers is never changed, and new text uses the line
 * ending of the existing file.
 */
export function planClaudeMd(existing, blocks, update) {
  const eol = eolOf(existing);
  let content = existing;
  const added = [];
  const updated = [];
  const divergent = [];
  const problems = [];
  for (const b of blocks) {
    const scan = scanBlocks(content);
    const broken = scan.problems.filter((p) => p.id === b.id);
    if (broken.length) {
      for (const p of broken) if (!problems.some((q) => q.id === p.id && q.kind === p.kind)) problems.push(p);
      continue;
    }
    const current = scan.blocks.get(b.id);
    const rendered = renderBlock(b.id, b.text, b.variant).replace(/\n/g, eol);
    if (!current) {
      content = `${content.replace(/\s*$/, "")}${content.trim() ? eol + eol : ""}${rendered}${eol}`;
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
  return { content, added, updated, divergent, problems };
}

/** Appends gitignore entries that are missing; existing lines are never touched. */
export function planGitignore(existing, entries) {
  const eol = eolOf(existing);
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const added = entries.filter((e) => !present.has(e));
  const content = added.length ? `${existing.replace(/\s*$/, "")}${existing.trim() ? eol : ""}${added.join(eol)}${eol}` : existing;
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
  const { blocks: present, problems } = scanBlocks(claude);
  const answers = {
    worktrees: present.get("worktrees")?.variant ?? "none",
    execution: present.get("execution-mode")?.variant ?? "none",
  };
  for (const p of problems) {
    add(`claude-md:${p.id}`, "divergent", `CLAUDE.md has a malformed ${p.id} block (${p.kind}).`, "Fix the markers by hand; the block is left untouched.");
  }
  const broken = new Set(problems.map((p) => p.id));
  for (const b of expectedBlocks(conv, answers)) {
    const current = present.get(b.id);
    if (broken.has(b.id)) continue;
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

/**
 * Renders the rules for agents without the plugin. Both outputs carry the other-agents
 * header and the convention blocks `expectedBlocks` selects (minus the CLAUDE.md-only
 * header), each in marked sections so reruns replace only those sections.
 *
 * @param link the parsed `surf-roadmap.json`; its `project` is named in the header
 */
export function renderOtherAgents(conv, answers, link) {
  const header = conv.read("other-agents/header.md").replace(/\{\{project\}\}/g, link?.project ?? "named in surf-roadmap.json");
  const blocks = [{ id: "header", variant: null, text: header.trim() }, ...expectedBlocks(conv, answers).filter((b) => b.id !== "header")];
  const agentsMd = `${blocks.map((b) => renderBlock(b.id, b.text, b.variant)).join("\n\n")}\n`;
  const cursorRule = `---\ndescription: surf-roadmap conventions\nalwaysApply: true\n---\n${agentsMd}`;
  return { agentsMd, cursorRule, blocks };
}
