"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type GoTarget, isTypingTarget, SHORTCUTS, ShortcutMatcher } from "@/lib/shortcuts";
import { openCommandMenu } from "./command-menu";

/** Browser event the "c" shortcut raises; the new-system dialog on the page listens for it. */
export const NEW_SYSTEM_EVENT = "roadmap:new-system";

/** Where each `go` target leads inside a project. */
function projectPath(slug: string, target: Exclude<GoTarget, "home">, firstBoardSlug?: string): string {
  const base = `/p/${slug}`;
  switch (target) {
    case "overview":
      return base;
    case "boards":
      return firstBoardSlug ? `${base}/boards/${firstBoardSlug}` : `${base}/boards`;
    default:
      return `${base}/${target}`;
  }
}

/** Moves focus to the next or previous `[data-nav-item]` in DOM order, wrapping around. */
function moveFocus(dir: "next" | "prev") {
  const items = Array.from(document.querySelectorAll<HTMLElement>("[data-nav-item]"));
  if (items.length === 0) return;
  const at = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
  const to = at === -1 ? (dir === "next" ? 0 : items.length - 1) : (at + (dir === "next" ? 1 : -1) + items.length) % items.length;
  items[to].focus();
  items[to].scrollIntoView({ block: "nearest" });
}

/**
 * Global single-key and "g then …" shortcuts. Ignored while typing, inside
 * dialogs and menus, and with Ctrl, Meta or Alt held.
 *
 * @param options.projectSlug the current project; without it only "go home" navigates
 * @param options.canEdit whether the actor may create systems (gates "c")
 * @param options.onHelp opens the shortcuts dialog
 */
export function useShortcuts({
  projectSlug,
  firstBoardSlug,
  canEdit,
  onHelp,
}: {
  projectSlug?: string;
  firstBoardSlug?: string;
  canEdit: boolean;
  onHelp: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    const matcher = new ShortcutMatcher(SHORTCUTS);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(document.activeElement)) return;
      const action = matcher.press(e.key, Date.now());
      if (!action) return;
      if ("go" in action) {
        if (action.go === "home") router.push("/");
        else if (projectSlug) router.push(projectPath(projectSlug, action.go, firstBoardSlug));
      } else if ("focus" in action) {
        moveFocus(action.focus);
      } else if (action.event === "new-system") {
        if (projectSlug && canEdit) window.dispatchEvent(new Event(NEW_SYSTEM_EVENT));
      } else if (action.event === "search") {
        e.preventDefault();
        openCommandMenu();
      } else {
        onHelp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, projectSlug, firstBoardSlug, canEdit, onHelp]);
}
