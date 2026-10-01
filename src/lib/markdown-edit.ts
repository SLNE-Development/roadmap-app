/** The text of a Markdown editor and its selection, as offsets into `value`. */
export interface EditState {
  value: string;
  start: number;
  end: number;
}

/** A list marker at the start of a line: indent, bullet or number, and an optional task box. */
const LIST_MARKER = /^(\s*)(?:([-*+])|(\d+)\.)\s(\[[ xX]\]\s)?/;

/** The start of the line holding offset `at`. */
function lineStartOf(value: string, at: number): number {
  return at === 0 ? 0 : value.lastIndexOf("\n", at - 1) + 1;
}

/** The whole lines a selection touches; a selection ending right after a line break leaves the next line out. */
function lineRange(state: EditState): { from: number; to: number } {
  const last = state.end > state.start && state.value[state.end - 1] === "\n" ? state.end - 1 : state.end;
  const to = state.value.indexOf("\n", last);
  return { from: lineStartOf(state.value, state.start), to: to === -1 ? state.value.length : to };
}

/** Rewrites every touched line and moves the selection along with the first and the last change. */
function mapLines(state: EditState, change: (line: string) => string): EditState {
  const { from, to } = lineRange(state);
  const lines = state.value.slice(from, to).split("\n");
  const next = lines.map(change);
  const firstDelta = next[0].length - lines[0].length;
  const total = next.join("\n").length - (to - from);
  const start = Math.max(from, state.start + firstDelta);
  return { value: state.value.slice(0, from) + next.join("\n") + state.value.slice(to), start, end: Math.max(start, state.end + total) };
}

/** Surrounds the selection with `before`/`after` (or inserts the selected `placeholder`); wrapped text is unwrapped again. */
export function wrapSelection(state: EditState, before: string, after: string, placeholder: string): EditState {
  const { value, start, end } = state;
  if (start !== end && value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    return { value: value.slice(0, start - before.length) + value.slice(start, end) + value.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  const text = start === end ? placeholder : value.slice(start, end);
  return { value: value.slice(0, start) + before + text + after + value.slice(end), start: start + before.length, end: start + before.length + text.length };
}

/** Adds `prefix` to every touched line, or removes it when all of them have it; a heading prefix replaces another heading level. */
export function toggleLinePrefix(state: EditState, prefix: string): EditState {
  const { from, to } = lineRange(state);
  const filled = state.value.slice(from, to).split("\n").filter((l) => l.trim());
  const remove = filled.length > 0 && filled.every((l) => l.startsWith(prefix));
  const heading = prefix.startsWith("#");
  return mapLines(state, (line) => {
    if (remove) return line.startsWith(prefix) ? line.slice(prefix.length) : line;
    if (!line.trim()) return line;
    return prefix + (heading ? line.replace(/^#{1,6} /, "") : line);
  });
}

/** Turns the selection into `[text](https://)` with the url selected. */
export function insertLink(state: EditState): EditState {
  const { value, start, end } = state;
  const text = start === end ? "text" : value.slice(start, end);
  const head = value.slice(0, start) + "[" + text + "](";
  return { value: head + "https://)" + value.slice(end), start: head.length, end: head.length + "https://".length };
}

/** Puts `block` on its own lines in place of the selection and leaves the caret after it. */
export function insertBlock(state: EditState, block: string): EditState {
  const { value, start, end } = state;
  const text = (start > 0 && value[start - 1] !== "\n" ? "\n" : "") + block + "\n";
  const caret = start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: caret, end: caret };
}

/**
 * What Enter does inside a list item: the next item (bullets repeat, numbers count up, task items start unchecked).
 * An empty item ends the list and is emptied. `null` outside a list or when the caret is in the marker.
 */
export function continueList(state: EditState): EditState | null {
  const { value, start, end } = state;
  if (start !== end) return null;
  const from = lineStartOf(value, start);
  const to = value.indexOf("\n", start) === -1 ? value.length : value.indexOf("\n", start);
  const line = value.slice(from, to);
  const match = LIST_MARKER.exec(line);
  if (!match || start - from < match[0].length) return null;
  if (!line.slice(match[0].length).trim()) {
    return { value: value.slice(0, from) + value.slice(to), start: from, end: from };
  }
  const marker = match[1] + (match[2] ?? `${Number(match[3]) + 1}.`) + " " + (match[4] ? "[ ] " : "");
  const insert = "\n" + marker;
  return { value: value.slice(0, start) + insert + value.slice(start), start: start + insert.length, end: start + insert.length };
}

/** Indents every touched line by two spaces, or removes up to two leading spaces (or a tab). */
export function indentLines(state: EditState, outdent: boolean): EditState {
  return mapLines(state, (line) => (outdent ? line.replace(/^(?: {1,2}|\t)/, "") : "  " + line));
}

/** Whether any line the selection touches is a list item; Tab only indents then. */
export function touchesList(state: EditState): boolean {
  const { from, to } = lineRange(state);
  return state.value.slice(from, to).split("\n").some((l) => LIST_MARKER.test(l));
}
