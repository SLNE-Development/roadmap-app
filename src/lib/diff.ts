import { createTwoFilesPatch, diffLines, diffWordsWithSpace } from "diff";

/** One row of a diff; `parts` splits the text so changed words can be highlighted. */
export type DiffLine = { kind: "same" | "add" | "del"; oldNo: number | null; newNo: number | null; parts: { text: string; changed: boolean }[] };

/** A group of changes with their surrounding lines; `header` names the section they sit in. */
export type DiffHunk = { header: string; lines: DiffLine[] };

const HEADING = /^#{1,6}\s+\S/;

/** Splits a diff chunk into lines without their line breaks. */
function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Word-level parts of a removed line and the added line that replaces it. */
function wordParts(oldText: string, newText: string): { del: DiffLine["parts"]; add: DiffLine["parts"] } {
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
 * lines are kept around every change.
 */
export function diffDocuments(oldBody: string, newBody: string, context = 3): { hunks: DiffHunk[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  const changes = diffLines(oldBody, newBody);
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
      return { kind: "del", oldNo: oldNo++, newNo: null, parts: partner === undefined ? [{ text, changed: true }] : wordParts(text, partner).del };
    });
    const addLines: DiffLine[] = fresh.map((text, n) => {
      const partner = gone[n];
      return { kind: "add", oldNo: null, newNo: newNo++, parts: partner === undefined ? [{ text, changed: true }] : wordParts(partner, text).add };
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

/** A unified diff (as `git diff` prints it) of two bodies with three lines of context. */
export function unifiedDiff(oldBody: string, newBody: string, oldLabel: string, newLabel: string): string {
  return createTwoFilesPatch(oldLabel, newLabel, oldBody, newBody, undefined, undefined, { context: 3 });
}
