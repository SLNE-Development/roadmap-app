import { createTwoFilesPatch, diffLines, diffWordsWithSpace, formatPatch } from "diff";

/** One row of a diff; `parts` splits the text so changed words can be highlighted. */
export type DiffLine = { kind: "same" | "add" | "del"; oldNo: number | null; newNo: number | null; parts: { text: string; changed: boolean }[] };

/** A group of changes with their surrounding lines; `header` names the section they sit in. */
export type DiffHunk = { header: string; lines: DiffLine[] };

const HEADING = /^#{1,6}\s+\S/;

/** Milliseconds jsdiff may spend before giving up and the whole document counts as rewritten. */
const DIFF_TIMEOUT_MS = 1000;

/** Splits a diff chunk into lines without their line breaks. */
function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Lines longer than this are not compared word by word; the whole line counts as changed. */
const MAX_WORD_DIFF_LINE = 2000;

/**
 * Word-level parts of a removed line and the added line that replaces it. A line over
 * {@link MAX_WORD_DIFF_LINE} characters is one changed part on each side.
 */
function wordParts(oldText: string, newText: string): { del: DiffLine["parts"]; add: DiffLine["parts"] } {
  if (oldText.length > MAX_WORD_DIFF_LINE || newText.length > MAX_WORD_DIFF_LINE) {
    return { del: [{ text: oldText, changed: true }], add: [{ text: newText, changed: true }] };
  }
  const del: DiffLine["parts"] = [];
  const add: DiffLine["parts"] = [];
  for (const part of diffWordsWithSpace(oldText, newText)) {
    if (part.added) add.push({ text: part.value, changed: true });
    else if (part.removed) del.push({ text: part.value, changed: true });
    else {
      del.push({ text: part.value, changed: false });
      add.push({ text: part.value, changed: false });
    }
  }
  return { del, add };
}

/**
 * Compares two markdown bodies line by line. Each run of removed lines followed
 * by added lines is paired one to one and marked by word; `context` unchanged
 * lines are kept around every change. When the line diff takes too long, every
 * old line counts as removed and every new line as added, without word marks.
 */
export function diffDocuments(oldBody: string, newBody: string, context = 3): { hunks: DiffHunk[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  const bounded = diffLines(oldBody, newBody, { timeout: DIFF_TIMEOUT_MS });
  const rewrite = bounded === undefined;
  const changes = bounded ?? [
    { value: oldBody, added: false, removed: true, count: 0 },
    { value: newBody, added: true, removed: false, count: 0 },
  ];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      for (const text of linesOf(change.value)) lines.push({ kind: "same", oldNo: oldNo++, newNo: newNo++, parts: [{ text, changed: false }] });
      continue;
    }
    const next = changes[i + 1];
    const paired = change.removed && next?.added ? next : null;
    const gone = change.removed ? linesOf(change.value) : [];
    const fresh = paired ? linesOf(paired.value) : change.added ? linesOf(change.value) : [];
    const delLines: DiffLine[] = gone.map((text, n) => {
      const partner = fresh[n];
      return { kind: "del", oldNo: oldNo++, newNo: null, parts: partner === undefined || rewrite ? [{ text, changed: true }] : wordParts(text, partner).del };
    });
    const addLines: DiffLine[] = fresh.map((text, n) => {
      const partner = gone[n];
      return { kind: "add", oldNo: null, newNo: newNo++, parts: partner === undefined || rewrite ? [{ text, changed: true }] : wordParts(partner, text).add };
    });
    removed += delLines.length;
    added += addLines.length;
    lines.push(...delLines, ...addLines);
    if (paired) i++;
  }

  const hunks: DiffHunk[] = [];
  let start = -1;
  let end = -1;
  const flush = () => {
    if (start < 0) return;
    hunks.push(buildHunk(lines, start, end));
    start = -1;
  };
  lines.forEach((line, i) => {
    if (line.kind === "same") return;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    if (start >= 0 && from <= end + 1) end = Math.max(end, to);
    else {
      flush();
      start = from;
      end = to;
    }
  });
  flush();
  return { hunks, added, removed };
}

/** The hunk for `lines[start..end]`, headed by the nearest markdown heading or a `@@` range. */
function buildHunk(lines: DiffLine[], start: number, end: number): DiffHunk {
  const slice = lines.slice(start, end + 1);
  const firstChange = start + slice.findIndex((l) => l.kind !== "same");
  for (let i = firstChange; i >= 0; i--) {
    const line = lines[i];
    if (line.kind === "del") continue;
    const text = line.parts.map((p) => p.text).join("");
    if (HEADING.test(text)) return { header: text.trim(), lines: slice };
  }
  const oldCount = slice.filter((l) => l.kind !== "add").length;
  const newCount = slice.filter((l) => l.kind !== "del").length;
  const oldBefore = lines.slice(0, start).filter((l) => l.kind !== "add").length;
  const newBefore = lines.slice(0, start).filter((l) => l.kind !== "del").length;
  const oldStart = oldCount > 0 ? oldBefore + 1 : oldBefore;
  const newStart = newCount > 0 ? newBefore + 1 : newBefore;
  return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice };
}

/** Patch lines for a whole body, each prefixed with `sign`, plus the number of body lines. */
function patchLines(body: string, sign: "-" | "+"): { lines: string[]; count: number } {
  if (body === "") return { lines: [], count: 0 };
  const lines = linesOf(body).map((line) => sign + line);
  const count = lines.length;
  if (!body.endsWith("\n")) lines.push("\\ No newline at end of file");
  return { lines, count };
}

/**
 * A unified diff (as `git diff` prints it) of two bodies with three lines of context.
 * When the diff takes too long, the patch removes every old line and adds every new one.
 */
export function unifiedDiff(oldBody: string, newBody: string, oldLabel: string, newLabel: string): string {
  const patch = createTwoFilesPatch(oldLabel, newLabel, oldBody, newBody, undefined, undefined, { context: 3, timeout: DIFF_TIMEOUT_MS });
  if (patch !== undefined) return patch;
  const gone = patchLines(oldBody, "-");
  const fresh = patchLines(newBody, "+");
  return formatPatch({
    oldFileName: oldLabel,
    newFileName: newLabel,
    oldHeader: undefined,
    newHeader: undefined,
    hunks: [{ oldStart: 1, oldLines: gone.count, newStart: 1, newLines: fresh.count, lines: [...gone.lines, ...fresh.lines] }],
  });
}
