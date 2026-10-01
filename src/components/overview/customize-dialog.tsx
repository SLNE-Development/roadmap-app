"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { PanelId } from "@/lib/overview-panels";
import { useTRPC } from "@/trpc/client";

/** Panel names as the overview shows them. */
const PANEL_LABELS: Record<PanelId, string> = {
  status: "Systems by status",
  attention: "Needs attention",
  phases: "Phases",
  updates: "Latest updates",
};

/**
 * Dialog choosing which overview panels show and in which order; the choice is
 * personal and applies to every project.
 *
 * @param props.panels the panels now, in order
 */
export function CustomizeDialog({
  panels,
  open,
  onOpenChange,
}: {
  panels: { id: PanelId; visible: boolean }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CustomizeForm panels={panels} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The form of {@link CustomizeDialog}; mounted only while the dialog is open, so it starts from the saved panels each time. */
function CustomizeForm({ panels, onDone }: { panels: { id: PanelId; visible: boolean }[]; onDone: () => void }) {
  const trpc = useTRPC();
  const save = useMutation(trpc.prefs.set.mutationOptions({ onSuccess: () => (toast.success("Overview saved"), onDone()) }));
  const [rows, setRows] = useState(panels);

  const shift = (i: number, by: number) =>
    setRows((prev) => {
      const next = [...prev];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const toggle = (id: PanelId, visible: boolean) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, visible } : r)));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Customize overview</DialogTitle>
        <DialogDescription>Choose which panels the overview of every project shows, and in which order.</DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col border">
        {rows.map((r, i) => {
          const label = PANEL_LABELS[r.id];
          return (
            <li key={r.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
              <Switch aria-label={label} checked={r.visible} onCheckedChange={(checked) => toggle(r.id, checked)} />
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => shift(i, -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${label} down`} disabled={i === rows.length - 1} onClick={() => shift(i, 1)}>
                <ArrowDown />
              </Button>
            </li>
          );
        })}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              key: "overview.panels",
              value: { order: rows.map((r) => r.id), hidden: rows.filter((r) => !r.visible).map((r) => r.id) },
            })
          }
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
