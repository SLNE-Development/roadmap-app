"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SHORTCUTS, type Shortcut } from "@/lib/shortcuts";
import type en from "../../../messages/en";

interface Row {
  keys: string[];
  /** The `shell.shortcuts` key of the label. */
  label: ShortcutLabel;
}

type ShortcutLabel = keyof typeof en.shell.shortcuts;

/** The `shell.shortcuts` key of each shortcut's label, by its keys; `SHORTCUTS` keeps the English labels for other users. */
export const LABELS: Record<string, ShortcutLabel> = {
  "g h": "goHome",
  "g o": "goOverview",
  "g b": "goBoards",
  "g s": "goSystems",
  "g a": "goActivity",
  "g q": "goQuestions",
  "g d": "goDecisions",
  "g r": "goRoadmap",
  c: "newSystem",
  "/": "search",
  j: "nextItem",
  k: "previousItem",
  "?": "showShortcuts",
};

const row = (s: Shortcut): Row => ({ keys: s.keys, label: LABELS[s.keys.join(" ")] });

/** The shortcuts by group, plus the two handled outside `SHORTCUTS`: ⌘K and moving a card. */
const GROUPS: { title: "groupNavigation" | "groupActions" | "groupLists"; rows: Row[] }[] = [
  { title: "groupNavigation", rows: SHORTCUTS.filter((s) => "go" in s.action).map(row) },
  {
    title: "groupActions",
    rows: [...SHORTCUTS.filter((s) => "event" in s.action).map(row), { keys: ["⌘K", "Ctrl+K"], label: "search" }],
  },
  {
    title: "groupLists",
    rows: [...SHORTCUTS.filter((s) => "focus" in s.action).map(row), { keys: ["Alt+←", "Alt+→"], label: "moveCard" }],
  },
];

/** Lists the keyboard shortcuts, opened by "?" or from the command menu. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("shell.shortcuts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-[19px] font-semibold">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t(g.title)}</h3>
              <ul className="flex flex-col">
                {g.rows.map((r) => (
                  <li key={r.label + r.keys.join()} className="flex items-center justify-between gap-4 border-t py-1.5 text-sm first:border-t-0">
                    <span className="min-w-0">{t(r.label)}</span>
                    <span className="flex items-center gap-1.5">
                      {r.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-xs text-muted-foreground">{r.keys[0].length === 1 ? t("then") : "/"}</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
