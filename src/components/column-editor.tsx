"use client";

import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setBoardColumnsAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COLUMN_CATEGORIES, type ColumnCategory } from "@/db/schema";
import { CategoryDot } from "./chips";

/** A column being edited; `id` is absent for new columns. */
interface DraftColumn {
  key: string;
  id?: string;
  name: string;
  category: ColumnCategory;
}

/**
 * Dialog editing a board's columns: rename, recategorise, reorder, add and remove.
 * The server checks the rules (one planning column, at least one done column,
 * no deleting columns that hold systems).
 */
export function ColumnEditor({
  projectSlug,
  boardSlug,
  columns,
}: {
  projectSlug: string;
  boardSlug: string;
  columns: { id: string; name: string; category: ColumnCategory }[];
}) {
  const initial = () => columns.map((c) => ({ key: c.id, id: c.id, name: c.name, category: c.category }));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftColumn[]>(initial);
  const [pending, startTransition] = useTransition();

  /** Replaces the column at `index` with `patch` applied. */
  const change = (index: number, patch: Partial<DraftColumn>) => setDraft((d) => d.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  /** Moves the column at `index` by `delta` positions. */
  const shift = (index: number, delta: number) =>
    setDraft((d) => {
      const next = [...d];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(initial());
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Edit columns</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            The category gives a column its meaning. Exactly one column is the planning column, and at least one is done.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-2">
          {draft.map((c, i) => (
            <li key={c.key} className="flex items-center gap-2">
              <CategoryDot category={c.category} />
              <Input aria-label={`Name of column ${i + 1}`} value={c.name} onChange={(e) => change(i, { name: e.target.value })} className="flex-1" />
              <NativeSelect aria-label={`Category of ${c.name}`} value={c.category} onChange={(e) => change(i, { category: e.target.value as ColumnCategory })}>
                {COLUMN_CATEGORIES.map((cat) => (
                  <NativeSelectOption key={cat} value={cat}>
                    {cat}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button variant="ghost" size="icon" aria-label={`Move ${c.name} up`} onClick={() => shift(i, -1)} disabled={i === 0}>
                <ArrowUpIcon />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${c.name} down`} onClick={() => shift(i, 1)} disabled={i === draft.length - 1}>
                <ArrowDownIcon />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${c.name}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setDraft((d) => [...d, { key: crypto.randomUUID(), name: "New column", category: "todo" }])}
        >
          Add column
        </Button>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setBoardColumnsAction(projectSlug, boardSlug, {
                  columns: draft.map(({ id, name, category }) => ({ id, name, category })),
                });
                if (!result.ok) return void toast.error(result.error);
                toast.success("Columns saved");
                setOpen(false);
              })
            }
          >
            Save columns
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
