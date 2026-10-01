/** Where a `go` shortcut navigates. */
export type GoTarget = "overview" | "boards" | "systems" | "activity" | "questions" | "adrs" | "roadmap" | "home";

/** What a shortcut does: navigate, raise a window event, or move focus between list items. */
export type ShortcutAction = { go: GoTarget } | { event: "new-system" | "search" | "help" } | { focus: "next" | "prev" };

/** A shortcut: single keys or a two-key sequence such as `["g", "b"]`. */
export interface Shortcut {
  keys: string[];
  label: string;
  action: ShortcutAction;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ["g", "h"], label: "Go home", action: { go: "home" } },
  { keys: ["g", "o"], label: "Go to overview", action: { go: "overview" } },
  { keys: ["g", "b"], label: "Go to boards", action: { go: "boards" } },
  { keys: ["g", "s"], label: "Go to systems", action: { go: "systems" } },
  { keys: ["g", "a"], label: "Go to activity", action: { go: "activity" } },
  { keys: ["g", "q"], label: "Go to questions", action: { go: "questions" } },
  { keys: ["g", "d"], label: "Go to decisions", action: { go: "adrs" } },
  { keys: ["g", "r"], label: "Go to roadmap", action: { go: "roadmap" } },
  { keys: ["c"], label: "New system", action: { event: "new-system" } },
  { keys: ["/"], label: "Search", action: { event: "search" } },
  { keys: ["j"], label: "Next item", action: { focus: "next" } },
  { keys: ["k"], label: "Previous item", action: { focus: "prev" } },
  { keys: ["?"], label: "Show shortcuts", action: { event: "help" } },
];

/** True when key presses belong to what the user is typing into or operating: a form control, editable text, the ⌘K palette, a dialog or a menu. */
export function isTypingTarget(el: { tagName: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null): boolean {
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return true;
  return ["[cmdk-root]", '[role="dialog"]', '[role="menu"]'].some((selector) => Boolean(el.closest?.(selector)));
}

/** Matches key presses against shortcuts, holding the first key of a sequence for `sequenceTimeoutMs`. */
export class ShortcutMatcher {
  private pending: string | null = null;
  private pendingAt = 0;

  constructor(
    private readonly shortcuts: Shortcut[],
    private readonly sequenceTimeoutMs = 1000,
  ) {}

  /** Feeds one key (as `event.key`) at time `now` (ms); returns the action it completes, or null. */
  press(key: string, now: number): ShortcutAction | null {
    const first = this.pending !== null && now - this.pendingAt <= this.sequenceTimeoutMs ? this.pending : null;
    this.pending = null;
    if (first !== null) {
      return this.shortcuts.find((s) => s.keys.length === 2 && s.keys[0] === first && s.keys[1] === key)?.action ?? null;
    }
    if (this.shortcuts.some((s) => s.keys.length === 2 && s.keys[0] === key)) {
      this.pending = key;
      this.pendingAt = now;
      return null;
    }
    return this.shortcuts.find((s) => s.keys.length === 1 && s.keys[0] === key)?.action ?? null;
  }
}
