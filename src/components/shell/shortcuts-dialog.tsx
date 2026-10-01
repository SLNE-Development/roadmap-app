"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SHORTCUTS, type Shortcut } from "@/lib/shortcuts";

interface Row {
  keys: string[];
  label: string;
}

const row = (s: Shortcut): Row => ({ keys: s.keys, label: s.label });

/** The shortcuts by group, plus the two handled outside `SHORTCUTS`: ⌘K and moving a card. */
const GROUPS: { title: string; rows: Row[] }[] = [
  { title: "Navigation", rows: SHORTCUTS.filter((s) => "go" in s.action).map(row) },
  {
    title: "Actions",
    rows: [...SHORTCUTS.filter((s) => "event" in s.action).map(row), { keys: ["⌘K", "Ctrl+K"], label: "Search" }],
  },
  {
    title: "Lists",
    rows: [...SHORTCUTS.filter((s) => "focus" in s.action).map(row), { keys: ["Alt+←", "Alt+→"], label: "Move the focused card" }],
  },
];

/** Lists the keyboard shortcuts, opened by "?" or from the command menu. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-[19px] font-semibold">Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are ignored while you type or have a dialog open.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              <ul className="flex flex-col">
                {g.rows.map((r) => (
                  <li key={r.label + r.keys.join()} className="flex items-center justify-between gap-4 border-t py-1.5 text-sm first:border-t-0">
                    <span>{r.label}</span>
                    <span className="flex items-center gap-1.5">
                      {r.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-xs text-muted-foreground">{r.keys[0].length === 1 ? "then" : "/"}</span>}
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
