"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveSystemAction } from "@/app/(app)/p/[project]/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ColumnCategory, Priority } from "@/db/schema";
import { cn } from "@/lib/utils";
import { CategoryDot, OwnerBadge, PriorityBadge } from "./chips";

/** A column of the board. */
export interface BoardColumnView {
  id: string;
  name: string;
  category: ColumnCategory;
}

/** A system card on the board. */
export interface BoardCardView {
  slug: string;
  title: string;
  priority: Priority;
  ownerName: string | null;
  columnId: string;
  planningComplete: boolean;
}

/**
 * Kanban board over custom columns. Dragging a card onto a column, or choosing a
 * column in the card's menu, moves the system; the server enforces the planning gate.
 */
export function BoardView({
  projectSlug,
  columns,
  cards,
  canEdit,
}: {
  projectSlug: string;
  columns: BoardColumnView[];
  cards: BoardCardView[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [optimistic, moveOptimistic] = useOptimistic(cards, (state, move: { slug: string; columnId: string }) =>
    state.map((c) => (c.slug === move.slug ? { ...c, columnId: move.columnId } : c)),
  );

  /** Moves a card to a column and persists it; a refusal restores the card and shows why. */
  const move = (slug: string, columnId: string) => {
    const card = optimistic.find((c) => c.slug === slug);
    if (!card || card.columnId === columnId || !canEdit) return;
    startTransition(async () => {
      moveOptimistic({ slug, columnId });
      const result = await moveSystemAction(projectSlug, slug, { column: columnId });
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="overflow-x-auto pb-2" aria-busy={pending}>
      <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-3">
        {columns.map((col) => {
          const items = optimistic.filter((c) => c.columnId === col.id);
          return (
            <section
              key={col.id}
              aria-label={col.name}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                move(e.dataTransfer.getData("text/plain"), col.id);
              }}
              className={cn("flex min-h-48 flex-col gap-2 rounded-lg border bg-muted/40 p-2", dragOver === col.id && "border-primary")}
            >
              <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
                <CategoryDot category={col.category} />
                {col.name}
                <span className="ml-auto text-muted-foreground tabular-nums">{items.length}</span>
              </h2>
              {items.map((c) => (
                <Card
                  key={c.slug}
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.slug)}
                  className={cn(canEdit && "cursor-grab active:cursor-grabbing")}
                >
                  <CardContent className="flex flex-col gap-2">
                    <Link href={`/p/${projectSlug}/systems/${c.slug}`} className="text-sm font-medium hover:underline">
                      {c.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PriorityBadge priority={c.priority} />
                      <OwnerBadge name={c.ownerName} />
                      {!c.planningComplete && <Badge variant="outline">planning open</Badge>}
                    </div>
                    {canEdit && (
                      <NativeSelect
                        size="sm"
                        aria-label={`Move ${c.title}`}
                        value={c.columnId}
                        disabled={pending}
                        onChange={(e) => move(c.slug, e.target.value)}
                      >
                        {columns.map((o) => (
                          <NativeSelectOption key={o.id} value={o.id}>
                            {o.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
