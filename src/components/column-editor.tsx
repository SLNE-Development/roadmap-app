"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ColumnRulesDialog } from "@/components/settings/column-rules-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { COLUMN_CATEGORIES, type ColumnCategory } from "@/db/schema";
import type { ColumnRuleRow } from "@/lib/ops/gates";
import { useTRPC } from "@/trpc/client";
import { CATEGORY_LABEL, CategoryDot } from "./chips";
import { mergeColumnCounts, type DraftColumn } from "./column-draft";

/** "3 systems", "1 system" or "empty". */
const holding = (n: number) => (n === 0 ? "empty" : n === 1 ? "1 system" : `${n} systems`);

/** A button with the category's dot and label, opening a menu of categories. */
function CategoryMenu({ value, onChange, label }: { value: ColumnCategory; onChange: (c: ColumnCategory) => void; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} className="w-full justify-start gap-2 bg-transparent font-normal">
          <CategoryDot category={value} />
          <span className="flex-1 text-left">{CATEGORY_LABEL[value]}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ColumnCategory)}>
          {COLUMN_CATEGORIES.map((cat) => (
            <DropdownMenuRadioItem key={cat} value={cat}>
              <CategoryDot category={cat} />
              {CATEGORY_LABEL[cat]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The column editor of a board: rename, recategorise, reorder, add and remove
 * columns, then save them together. The server checks the rules (one planning
 * column, at least one done column, no deleting columns that hold systems);
 * the remove button is already disabled for columns holding systems.
 * Without `canEdit` the columns are listed read-only.
 */
export function ColumnEditor({
  projectSlug,
  boardSlug,
  columns,
  canEdit,
}: {
  projectSlug: string;
  boardSlug: string;
  columns: { id: string; name: string; category: ColumnCategory; systemCount: number; rules: ColumnRuleRow[] }[];
  canEdit: boolean;
}) {
  const initial = () => columns.map((c) => ({ key: c.id, ...c }));
  const [draft, setDraft] = useState<DraftColumn[]>(initial);
  // Refetches refresh the system counts without touching unsaved edits.
  const [seenColumns, setSeenColumns] = useState(columns);
  if (columns !== seenColumns) {
    setSeenColumns(columns);
    setDraft((d) => mergeColumnCounts(d, columns));
  }
  const trpc = useTRPC();
  // The toast sits on the mutation, not on `mutate`: the refetched columns re-key and remount this editor before the mutation settles.
  const save = useMutation(trpc.boards.setColumns.mutationOptions({ onSuccess: () => toast.success("Columns saved") }));
  const pending = save.isPending;
  const dirty =
    draft.length !== columns.length ||
    draft.some((d, i) => d.id !== columns[i].id || d.name !== columns[i].name || d.category !== columns[i].category);

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

  const rule = "Exactly one planning column and at least one done column. Columns that hold systems can’t be removed.";

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Columns</h3>
          <p className="text-[12.5px] text-muted-foreground">Only owners can change columns.</p>
        </div>
        <ol className="flex flex-col border">
          {columns.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 border-b px-3 py-2 text-[13.5px] last:border-b-0">
              <CategoryDot category={c.category} />
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[c.category]}</span>
              <ColumnRulesDialog projectSlug={projectSlug} boardSlug={boardSlug} column={c} canEdit={false} />
              <span className="w-16 text-right text-xs text-muted-foreground">{holding(c.systemCount)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5" aria-busy={pending}>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Columns</h3>
        <p className="text-[12.5px] text-muted-foreground">{rule}</p>
      </div>
      <ol className="flex flex-col border">
        {draft.map((c, i) => (
          <li
            key={c.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b px-2.5 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_150px_60px_auto_auto]"
          >
            <Input
              aria-label={`Name of column ${i + 1}`}
              value={c.name}
              onChange={(e) => change(i, { name: e.target.value })}
              className="h-[30px] px-2"
            />
            <div className="order-last col-span-2 sm:order-none sm:col-span-1">
              <CategoryMenu value={c.category} onChange={(category) => change(i, { category })} label={`Category of ${c.name || `column ${i + 1}`}`} />
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">{c.id ? holding(c.systemCount) : "new"}</span>
            {c.id ? (
              <ColumnRulesDialog
                projectSlug={projectSlug}
                boardSlug={boardSlug}
                column={{ id: c.id, name: c.name, category: c.category, rules: columns.find((s) => s.id === c.id)?.rules ?? [] }}
                canEdit
              />
            ) : (
              <span className="text-xs text-muted-foreground">Save columns to add rules</span>
            )}
            <span className="flex items-center">
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} up`} onClick={() => shift(i, -1)} disabled={i === 0} className="text-muted-foreground">
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${c.name} down`}
                onClick={() => shift(i, 1)}
                disabled={i === draft.length - 1}
                className="text-muted-foreground"
              >
                <ArrowDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={c.systemCount > 0 ? `${c.name} holds systems and can’t be removed` : `Remove ${c.name}`}
                title={c.systemCount > 0 ? "Move its systems first" : undefined}
                disabled={c.systemCount > 0}
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                className="text-muted-foreground"
              >
                <XIcon />
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-dashed bg-transparent text-fg-2"
          onClick={() => setDraft((d) => [...d, { key: crypto.randomUUID(), name: "New column", category: "todo", systemCount: 0 }])}
        >
          <PlusIcon />
          Add column
        </Button>
        <span className="flex-1" />
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(initial())} disabled={pending}>
            Discard
          </Button>
        )}
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            save.mutate({ project: projectSlug, board: boardSlug, columns: draft.map(({ id, name, category }) => ({ id, name, category })) })
          }
        >
          Save columns
        </Button>
      </div>
    </div>
  );
}
