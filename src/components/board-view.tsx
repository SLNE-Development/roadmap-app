"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Ban, ChevronDown, ChevronRight, ChevronsLeft, Ellipsis, List, Lock, PieChart, Plus, Rows3, Search, SquareKanban } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { FilterChip } from "@/components/filter-chip";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { PageHeader, ProgressBar } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { SaveViewButton } from "@/components/save-view-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRIORITIES, type ColumnCategory } from "@/db/schema";
import type { BoardCardView } from "@/lib/board-card";
import type { CardField } from "@/lib/card-fields";
import { focusReady, moveKey, moveTargets } from "@/lib/board-moves";
import { groupIntoLanes, LANE_KEYS, type LaneKey } from "@/lib/lanes";
import { BOARD_COLLAPSED_SCHEMA } from "@/lib/pref-keys";
import { plural } from "@/lib/text";
import { hasFilters, withParam, type BoardQuery } from "@/lib/url-filters";
import { cn } from "@/lib/utils";
import { activeChips, suggestViewName } from "@/lib/view-name";
import { useTRPC } from "@/trpc/client";
import { CardFieldsDialog, type CardFieldCustom } from "./board/card-fields-dialog";
import { BoardAnnouncer, moveMessage, refusedMessage } from "./board/board-announcer";
import { usePointerDrag } from "./board/use-pointer-drag";
import { CATEGORY_CLASS, CategoryDot, PriorityTag } from "./chips";
import { isOwnPush } from "./systems/systems-toolbar";

/** A column of the board. */
export interface BoardColumnView {
  id: string;
  name: string;
  category: ColumnCategory;
}

export type { BoardCardView };

/** A named option of a filter (domain, phase, member). */
interface NamedOption {
  id: string;
  name: string;
}

/** localStorage key remembering that the keyboard-move hint was shown. */
const CARD_MOVE_HINT_KEY = "roadmap.hint.cardMove";

/** The lane picker's option labels. */
const LANE_LABEL: Record<LaneKey, string> = { none: "None", domain: "Domain", phase: "Phase", owner: "Owner", priority: "Priority" };

/** Most avatars shown in the header's member stack. */
const STACK_SIZE = 5;

/**
 * The board page body: header with members, view toggle and actions, a filter
 * bar (its values live in the URL, see `query`), and the kanban over the board's columns. Dragging a card onto a column,
 * or choosing one in the card's menu, moves the system; the server enforces the
 * planning gate and a refusal restores the card with a toast.
 */
export function BoardView({
  projectSlug,
  projectName,
  boardId,
  board,
  boards,
  canEdit,
  canOwn,
  members,
  domains,
  phases,
  columns,
  cards,
  cardFields,
  customFields,
  gatesLanded,
  query,
}: {
  projectSlug: string;
  projectName: string;
  boardId: string;
  board: { slug: string; name: string };
  boards: { slug: string; name: string }[];
  canEdit: boolean;
  canOwn: boolean;
  members: { userId: string; name: string }[];
  domains: NamedOption[];
  phases: NamedOption[];
  columns: BoardColumnView[];
  cards: BoardCardView[];
  /** Fields the cards show, in order. */
  cardFields: CardField[];
  customFields: CardFieldCustom[];
  gatesLanded: boolean;
  query: BoardQuery;
}) {
  const [newSystemOpen, setNewSystemOpen] = useState(false);
  const [cardFieldsOpen, setCardFieldsOpen] = useState(false);
  const trpc = useTRPC();
  const moveSystem = useMutation(trpc.systems.move.mutationOptions());
  const [announce, setAnnounce] = useState("");
  const [showHint, setShowHint] = useState(false);
  // The card to refocus and the column it must be in first; moving a card re-creates its element, so the effect waits for that.
  const focusTarget = useRef<{ slug: string; columnId: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startFilter] = useTransition();
  const queryClient = useQueryClient();
  const collapsedKey = `board.collapsed.${boardId}`;
  const collapsedQuery = trpc.prefs.get.queryOptions({ key: collapsedKey });
  const { data: collapsedPref } = useSuspenseQuery(collapsedQuery);
  const setCollapsedPref = useMutation(
    trpc.prefs.set.mutationOptions({
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey: collapsedQuery.queryKey });
        const previous = queryClient.getQueryData(collapsedQuery.queryKey);
        queryClient.setQueryData(collapsedQuery.queryKey, vars.value);
        return { previous };
      },
      onError: (_error, _vars, context) => queryClient.setQueryData(collapsedQuery.queryKey, context?.previous ?? null),
    }),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [optimistic, moveOptimistic] = useOptimistic(cards, (state, move: { slug: string; columnId: string }) =>
    state.map((c) => (c.slug === move.slug ? { ...c, columnId: move.columnId } : c)),
  );

  const domainName = useMemo(() => new Map(domains.map((d) => [d.id, d.name])), [domains]);
  const phaseName = useMemo(() => new Map(phases.map((p) => [p.id, p.name])), [phases]);
  const customName = useMemo(() => new Map(customFields.map((f) => [f.key, f.name])), [customFields]);
  const categoryOf = useMemo(() => new Map(columns.map((c) => [c.id, c.category])), [columns]);

  // Without a saved choice the Done columns start collapsed; a saved one is authoritative.
  const saved = collapsedPref ? BOARD_COLLAPSED_SCHEMA.safeParse(collapsedPref) : null;
  const collapsed = saved?.success
    ? { columns: new Set(saved.data.columns), lanes: new Set(saved.data.lanes) }
    : { columns: new Set(columns.filter((c) => c.category === "done").map((c) => c.id)), lanes: new Set<string>() };
  const isCollapsed = (col: BoardColumnView) => col.category === "done" && collapsed.columns.has(col.id);
  /** Saves the collapsed state with one column or lane entry flipped, or set to `to`. */
  const flipCollapsed = (kind: "columns" | "lanes", entry: string, to?: boolean) => {
    const next = { columns: new Set(collapsed.columns), lanes: new Set(collapsed.lanes) };
    if (to ?? !next[kind].has(entry)) next[kind].add(entry);
    else next[kind].delete(entry);
    setCollapsedPref.mutate({ key: collapsedKey, value: { columns: [...next.columns], lanes: [...next.lanes] } });
  };

  /**
   * Moves a card to a column and persists it; a refusal restores the card and shows why.
   * Returns whether the move was accepted. A keyboard move keeps focus on the card and
   * opens a collapsed Done column once the server accepts it.
   */
  const move = (slug: string, columnId: string, byKey = false): boolean => {
    const card = optimistic.find((c) => c.slug === slug);
    if (!card || card.columnId === columnId || !canEdit) return false;
    if (byKey) focusTarget.current = { slug, columnId };
    startTransition(async () => {
      moveOptimistic({ slug, columnId });
      // A refusal is toasted by the mutation cache; the card falls back once the transition ends.
      const failure = await moveSystem
        .mutateAsync({ project: projectSlug, system: slug, to: { column: columnId } })
        .then(() => null, (error: Error) => error);
      // Re-armed after settling: on a refusal the card must end up back in its original column.
      if (byKey) focusTarget.current = { slug, columnId: failure ? card.columnId : columnId };
      if (!failure && collapsed.columns.has(columnId)) flipCollapsed("columns", columnId, false);
      const message = failure
        ? refusedMessage(card.title, failure.message)
        : moveMessage(card.title, columns.find((c) => c.id === columnId)?.name ?? "");
      // A trailing zero-width space makes an identical repeat a new text for the live region.
      setAnnounce((prev) => (prev === message ? `${message}​` : message));
    });
    return true;
  };

  /** A keyboard move of a card to a neighbouring column. */
  const moveByKey = (slug: string, columnId: string) => {
    if (move(slug, columnId, true)) setShowHint(false);
  };

  const { bind, draggingSlug, overColumnId } = usePointerDrag({ enabled: canEdit, onDrop: move });

  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    const el = document.querySelector<HTMLElement>(`[data-card-slug="${CSS.escape(target.slug)}"]`);
    if (!el || !focusReady(target, el.closest("[data-column-id]")?.getAttribute("data-column-id") ?? null)) return;
    focusTarget.current = null;
    el.focus();
  });

  /** Shows the keyboard-move hint on the first card focus ever; the key is written when it is shown. */
  const hintOnce = () => {
    if (!canEdit || showHint) return;
    try {
      if (localStorage.getItem(CARD_MOVE_HINT_KEY)) return;
      localStorage.setItem(CARD_MOVE_HINT_KEY, "1");
    } catch {
      // Storage blocked: skip the hint rather than repeat it on every focus.
      return;
    }
    setShowHint(true);
  };

  const needle = query.q.toLowerCase();
  const visible = optimistic.filter(
    (c) =>
      (!needle || c.title.toLowerCase().includes(needle)) &&
      (!query.domain || c.domainId === query.domain) &&
      (!query.phase || c.phaseId === query.phase) &&
      (!query.priority || c.priority === query.priority) &&
      (!query.owner || (query.owner === "none" ? c.ownerUserId === null : c.ownerUserId === query.owner)),
  );
  const blocked = visible.filter((c) => categoryOf.get(c.columnId) === "blocked").length;
  const planning = visible.filter((c) => categoryOf.get(c.columnId) === "planning").length;
  const draggedSlug = dragging ?? draggingSlug;
  const draggedFrom = draggedSlug ? optimistic.find((c) => c.slug === draggedSlug)?.columnId : undefined;

  /** Drag-and-drop handlers shared by open columns and collapsed strips. */
  const dropTarget = (columnId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit || !dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOver !== columnId) setDragOver(columnId);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver((v) => (v === columnId ? null : v));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const slug = e.dataTransfer.getData("text/plain") || dragging;
      setDragOver(null);
      setDragging(null);
      if (slug) move(slug, columnId);
    },
  });

  // Lane entries carry the lane kind so switching kinds does not carry the collapse over.
  const toggleLane = (laneKey: string) => flipCollapsed("lanes", `${query.lane}:${laneKey}`);

  const toggle = (columnId: string) => flipCollapsed("columns", columnId);

  /** Opens the header's New system dialog, which creates the system in planning. */
  const openNewSystem = () => setNewSystemOpen(true);

  /** Replaces the URL query with `key` set to `value`; empty removes it. */
  const setParam = (key: string, value: string | null) =>
    startFilter(() => router.replace(pathname + withParam(searchParams.toString(), key, value), { scroll: false }));
  /** Replaces the URL query with only the lane kept. */
  const clearFilters = () =>
    startFilter(() => router.replace(pathname + withParam("", "lane", query.lane === "none" ? null : query.lane), { scroll: false }));
  const named = (list: NamedOption[]) => list.map((o) => ({ value: o.id, label: o.name }));
  const ownerOptions = [...members.map((m) => ({ value: m.userId, label: m.name })), { value: "none", label: "Unowned" }];

  const lanes = groupIntoLanes(visible, query.lane, {
    domains: domainName,
    phases: new Map(phases.map((p) => [p.id, p.name])),
    domainOrder: domains.map((d) => d.id),
    phaseOrder: phases.map((p) => p.id),
  });

  /** A card of `col`; its drag and move handlers change only the column, whichever lane it sits in. */
  const renderCard = (c: BoardCardView, col: BoardColumnView) => (
    <SystemCard
      key={c.slug}
      card={c}
      category={col.category}
      columnName={col.name}
      domain={c.domainId ? (domainName.get(c.domainId) ?? null) : null}
      phase={c.phaseId ? (phaseName.get(c.phaseId) ?? null) : null}
      fields={cardFields}
      customName={customName}
      projectSlug={projectSlug}
      columns={columns}
      canEdit={canEdit}
      pending={pending}
      dragging={draggedSlug === c.slug}
      bound={bind(c.slug)}
      onFocus={hintOnce}
      onMoveKey={(columnId) => moveByKey(c.slug, columnId)}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", c.slug);
        e.dataTransfer.effectAllowed = "move";
        setDragging(c.slug);
      }}
      onDragEnd={() => {
        setDragging(null);
        setDragOver(null);
      }}
      onMove={(columnId) => move(c.slug, columnId)}
    />
  );

  /** The drop placeholder of a column while a card hovers it, or the empty note. */
  const dropHint = (col: BoardColumnView, count: number, isOver: boolean) =>
    isOver ? (
      <div className="flex h-16 shrink-0 items-center justify-center border-[1.5px] border-dashed border-primary bg-brand-soft text-xs font-medium text-brand-strong">
        Drop to move to {col.name}
      </div>
    ) : (
      count === 0 && <div className="flex h-16 shrink-0 items-center justify-center border border-dashed text-xs text-muted-foreground">No systems</div>
    );

  return (
    <>
      <PageHeader
        crumbs={[{ label: projectName, href: `/p/${projectSlug}` }, { label: "Boards" }]}
        title={board.name}
        actions={
          <>
            <MemberStack members={members} />
            <div role="group" aria-label="View" className="flex border bg-card p-[3px]">
              <span aria-current="page" title="Board view" className="flex h-[26px] w-[30px] items-center justify-center bg-secondary">
                <SquareKanban className="size-[15px]" aria-hidden />
                <span className="sr-only">Board view</span>
              </span>
              <Link
                href={`/p/${projectSlug}/systems?board=${board.slug}`}
                title="List view"
                className="flex h-[26px] w-[30px] items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <List className="size-[15px]" aria-hidden />
                <span className="sr-only">List view</span>
              </Link>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label={`Lanes: ${LANE_LABEL[query.lane]}`}>
                  <Rows3 />
                  Lanes
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Lanes</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={query.lane} onValueChange={(v) => setParam("lane", v === "none" ? null : v)}>
                  {LANE_KEYS.map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {LANE_LABEL[k]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Dragging across lanes changes only the column.</p>
              </DropdownMenuContent>
            </DropdownMenu>
            {canEdit && (
              <NewSystemDialog projectSlug={projectSlug} boards={boards} defaultBoard={board.slug} open={newSystemOpen} onOpenChange={setNewSystemOpen} />
            )}
            {canOwn && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Board options">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild>
                    <Link href={`/p/${projectSlug}/settings/boards?board=${board.slug}`}>Edit columns</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/p/${projectSlug}/settings/boards`}>New board</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCardFieldsOpen(true)}>Card fields…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canOwn && (
              <CardFieldsDialog
                projectSlug={projectSlug}
                boardSlug={board.slug}
                fields={cardFields}
                customFields={customFields}
                gatesLanded={gatesLanded}
                open={cardFieldsOpen}
                onOpenChange={setCardFieldsOpen}
              />
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <BoardSearch value={query.q} onCommit={(q) => setParam("q", q)} />
        {domains.length > 0 && <FilterChip label="Domain" options={named(domains)} value={query.domain ?? ""} onChange={(v) => setParam("domain", v)} />}
        {phases.length > 0 && <FilterChip label="Phase" options={named(phases)} value={query.phase ?? ""} onChange={(v) => setParam("phase", v)} />}
        <FilterChip
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          value={query.priority ?? ""}
          onChange={(v) => setParam("priority", v)}
        />
        <FilterChip label="Owner" options={ownerOptions} value={query.owner ?? ""} onChange={(v) => setParam("owner", v)} />
        {hasFilters(query) && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            Clear filters
          </Button>
        )}
        {hasFilters(query) && (
          <SaveViewButton
            path={pathname}
            query={searchParams.toString()}
            suggestedName={suggestViewName(
              board.name,
              activeChips(
                [
                  { key: "domain", label: "Domain", options: named(domains) },
                  { key: "phase", label: "Phase", options: named(phases) },
                  { key: "priority", label: "Priority", options: PRIORITIES.map((p) => ({ value: p, label: p })) },
                  { key: "owner", label: "Owner", options: ownerOptions },
                ],
                query,
              ),
            )}
          />
        )}
        <span className="ml-auto text-[12.5px] text-muted-foreground" aria-live="polite">
          {visible.length} {visible.length === 1 ? "system" : "systems"} ·{" "}
          <span className={cn(blocked > 0 && "font-semibold text-cat-blocked")}>{blocked} blocked</span> · {planning} in planning
        </span>
      </div>

      {showHint && <p className="text-[12.5px] text-muted-foreground">Alt+← / Alt+→ moves a card</p>}
      <BoardAnnouncer message={announce} />

      <div
        className={cn(
          "-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-9 lg:px-9",
          query.lane !== "none" && "max-h-[calc(100dvh-15rem)] overflow-y-auto",
        )}
        aria-busy={pending}
      >
        {query.lane === "none" ? (
        <div className="flex min-h-[calc(100dvh-15rem)] w-max items-stretch gap-3">
          {columns.map((col) => {
            const items = visible.filter((c) => c.columnId === col.id);
            const isOver = (dragOver ?? overColumnId) === col.id && draggedFrom !== undefined && draggedFrom !== col.id;

            if (isCollapsed(col)) {
              return (
                <section key={col.id} data-column-id={col.id} aria-label={`${col.name}, collapsed`} {...dropTarget(col.id)} className="flex w-10 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggle(col.id)}
                    aria-expanded={false}
                    aria-label={`Expand ${col.name}, ${items.length} systems`}
                    className={cn(
                      "flex w-full flex-col items-center gap-2.5 bg-column py-3 outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50",
                      isOver && "border-[1.5px] border-dashed border-primary bg-brand-soft",
                    )}
                  >
                    <CategoryDot category={col.category} />
                    <span className="text-[13px] font-semibold [writing-mode:vertical-rl]">{col.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                  </button>
                </section>
              );
            }

            return (
              <section key={col.id} data-column-id={col.id} aria-label={col.name} {...dropTarget(col.id)} className="flex w-[228px] shrink-0 flex-col gap-2 bg-column p-2">
                <header className="flex items-center gap-2 px-1 pt-1 pb-0.5">
                  <CategoryDot category={col.category} />
                  <h2 className="truncate text-[13px] font-semibold">{col.name}</h2>
                  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                  <span className="flex-1" />
                  {col.category === "done" && (
                    <Button variant="ghost" size="icon-xs" aria-label={`Collapse ${col.name}`} onClick={() => toggle(col.id)} className="text-muted-foreground">
                      <ChevronsLeft />
                    </Button>
                  )}
                  {canEdit && col.category === "planning" && (
                    <Button variant="ghost" size="icon-xs" aria-label="New system" onClick={openNewSystem} className="text-muted-foreground">
                      <Plus className="size-3.5" />
                    </Button>
                  )}
                </header>
                {col.category === "planning" && (
                  <p className="flex items-center gap-1.5 px-1 pb-0.5 text-[11.5px] text-muted-foreground">
                    <Lock className="size-3" aria-hidden />
                    Leaves after the planning interview
                  </p>
                )}
                {items.map((c) => renderCard(c, col))}
                {dropHint(col, items.length, isOver)}
              </section>
            );
          })}
        </div>
        ) : (
          <div className="w-max">
            <div className="sticky top-0 z-20 flex h-9 items-center gap-3 bg-background">
              {columns.map((col) => {
                const total = visible.filter((c) => c.columnId === col.id).length;
                if (isCollapsed(col)) {
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggle(col.id)}
                      aria-expanded={false}
                      aria-label={`Expand ${col.name}, ${total} systems`}
                      className="flex h-full w-10 shrink-0 items-center justify-center bg-column outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <CategoryDot category={col.category} />
                    </button>
                  );
                }
                return (
                  <div key={col.id} className="flex h-full w-[228px] shrink-0 items-center gap-2 bg-column px-3">
                    <CategoryDot category={col.category} />
                    <h2 className="truncate text-[13px] font-semibold">{col.name}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
                    <span className="flex-1" />
                    {col.category === "done" && (
                      <Button variant="ghost" size="icon-xs" aria-label={`Collapse ${col.name}`} onClick={() => toggle(col.id)} className="text-muted-foreground">
                        <ChevronsLeft />
                      </Button>
                    )}
                    {canEdit && col.category === "planning" && (
                      <Button variant="ghost" size="icon-xs" aria-label="New system" onClick={openNewSystem} className="text-muted-foreground">
                        <Plus className="size-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            {lanes.map((lane) => {
              const open = !collapsed.lanes.has(`${query.lane}:${lane.key}`);
              return (
                <div key={lane.key} role="group" aria-label={lane.name} className="mt-2">
                  <div className="sticky top-9 z-10 bg-background pb-1">
                    <button
                      type="button"
                      onClick={() => toggleLane(lane.key)}
                      aria-expanded={open}
                      className="flex w-full items-center border-y bg-secondary px-3 py-1.5 text-left text-[13px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="sticky left-3 flex items-center gap-2">
                        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                        {lane.name}
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">{lane.cards.length}</span>
                      </span>
                    </button>
                    <div className="flex gap-3 pt-0.5" aria-hidden>
                      {columns.map((col) => (
                        <span
                          key={col.id}
                          className={cn(
                            "shrink-0 text-[11.5px] text-muted-foreground tabular-nums",
                            isCollapsed(col) ? "w-10 text-center" : "w-[228px] px-3",
                          )}
                        >
                          {lane.countByColumn[col.id] ?? 0}
                        </span>
                      ))}
                    </div>
                  </div>
                  {open && (
                    <div className="flex items-stretch gap-3">
                      {columns.map((col) => {
                        const items = lane.cards.filter((c) => c.columnId === col.id);
                        const isOver = (dragOver ?? overColumnId) === col.id && draggedFrom !== undefined && draggedFrom !== col.id;
                        if (isCollapsed(col)) {
                          return (
                            <section
                              key={col.id}
                              data-column-id={col.id}
                              aria-label={`${col.name}, collapsed`}
                              {...dropTarget(col.id)}
                              className={cn("w-10 shrink-0 bg-column", isOver && "border-[1.5px] border-dashed border-primary bg-brand-soft")}
                            />
                          );
                        }
                        return (
                          <section key={col.id} data-column-id={col.id} aria-label={col.name} {...dropTarget(col.id)} className="flex w-[228px] shrink-0 flex-col gap-2 bg-column p-2">
                            {items.map((c) => renderCard(c, col))}
                            {dropHint(col, items.length, isOver)}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** One system on the board: domain, priority, title, blocker or planning state or progress, and owner. */
function SystemCard({
  card,
  category,
  columnName,
  domain,
  phase,
  fields,
  customName,
  projectSlug,
  columns,
  canEdit,
  pending,
  dragging,
  bound,
  onFocus,
  onMoveKey,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: BoardCardView;
  category: ColumnCategory;
  columnName: string;
  domain: string | null;
  phase: string | null;
  /** The fields to show, in order. */
  fields: CardField[];
  /** Names of the custom fields by key. */
  customName: Map<string, string>;
  projectSlug: string;
  columns: BoardColumnView[];
  canEdit: boolean;
  pending: boolean;
  dragging: boolean;
  /** Pointer handlers for touch dragging, empty when the viewer cannot edit. */
  bound: React.HTMLAttributes<HTMLElement>;
  onFocus: () => void;
  onMoveKey: (columnId: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (columnId: string) => void;
}) {
  const router = useRouter();
  const chip = "bg-secondary px-1.5 text-[11px] leading-[18px] whitespace-nowrap text-fg-2";
  /** The markup of one card field, or null when the card has nothing to show for it. */
  const cardField = (field: CardField): React.ReactNode => {
    switch (field) {
      case "owner":
        return card.ownerName ? (
          <span title={card.ownerName} className="ml-auto flex">
            <PersonAvatar name={card.ownerName} size="sm" className="ring-2 ring-card" />
            <span className="sr-only">Owner: {card.ownerName}</span>
          </span>
        ) : null;
      case "tasks":
        return category === "planning" ? (
          <span className="flex min-w-0 flex-1 basis-32 items-center gap-1.5 text-[11.5px] text-cat-planning">
            <PieChart className="size-[13px]" aria-hidden />
            {card.planningRounds === 0 ? "Interview not started" : `Planning: ${card.planningAreasCovered} of 4 areas`}
          </span>
        ) : card.tasksTotal > 0 ? (
          <span className="flex min-w-0 flex-1 basis-32 items-center gap-2">
            <ProgressBar value={card.tasksDone} total={card.tasksTotal} colorClass={CATEGORY_CLASS[category]} />
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {card.tasksDone}/{card.tasksTotal}
            </span>
          </span>
        ) : (
          <span className="flex-1 basis-32 text-[11.5px] text-muted-foreground">No tasks</span>
        );
      case "blocked":
        return category === "blocked" && card.latestSummary ? (
          <p className="flex w-full items-start gap-1.5 bg-cat-blocked-soft px-2 py-1.5 text-xs leading-[1.4] text-cat-blocked">
            <Ban className="mt-px size-[13px] shrink-0" aria-hidden />
            <span className="line-clamp-3">{card.latestSummary}</span>
          </p>
        ) : null;
      case "phase":
        return phase ? <span className={chip}>{phase}</span> : null;
      case "domain":
      case "priority":
      case "gates":
        return null;
      case "questions":
        return card.openQuestions > 0 ? (
          <span className={chip} title={plural(card.openQuestions, "open question")}>
            ? {card.openQuestions}
          </span>
        ) : null;
      case "estimate":
        return card.points - card.pointsDone > 0 ? <span className={chip}>{card.points - card.pointsDone} pts</span> : null;
      case "dependencies":
        return card.blockedBy.length > 0 ? (
          <span className={chip} title={card.blockedBy.join(", ")}>
            Waiting on {card.blockedBy.length}
          </span>
        ) : null;
      default: {
        const key = field.slice("custom:".length);
        const value = card.fields[key];
        return value ? (
          <span className={chip}>
            {customName.get(key) ?? key}: {value}
          </span>
        ) : null;
      }
    }
  };
  return (
    <article
      tabIndex={0}
      data-nav-item
      data-card-slug={card.slug}
      aria-roledescription="card"
      aria-label={`${card.title}, ${columnName}`}
      draggable={canEdit}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          router.push(`/p/${projectSlug}/systems/${card.slug}`);
          return;
        }
        const dir = moveKey(e);
        if (!dir) return;
        e.preventDefault();
        if (!canEdit) return;
        const target = moveTargets(columns, card.columnId)[dir];
        if (target) onMoveKey(target);
      }}
      {...bound}
      onDragStart={(e) => {
        bound.onDragStart?.(e);
        if (!e.defaultPrevented) onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex flex-col gap-2 border bg-card p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 shadow-[0_1px_0_color-mix(in_oklch,var(--foreground),transparent_96%)] transition-[transform,box-shadow]",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "rotate-[1.5deg] border-primary opacity-90 shadow-lg",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{fields.includes("domain") && (domain ?? "No domain")}</span>
        {fields.includes("priority") && <PriorityTag priority={card.priority} />}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${card.title}`} disabled={pending} className="-my-1 -mr-1.5 text-muted-foreground">
                <ArrowRightLeft />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Move to…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((o) => (
                <DropdownMenuItem key={o.id} disabled={o.id === card.columnId} onSelect={() => onMove(o.id)}>
                  <CategoryDot category={o.category} />
                  {o.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Link
        href={`/p/${projectSlug}/systems/${card.slug}`}
        draggable={false}
        className="text-[13.5px] leading-[1.35] font-semibold hover:underline"
      >
        {card.title}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 empty:hidden">
        {fields.map((field) => {
          const part = cardField(field);
          return part ? <Fragment key={field}>{part}</Fragment> : null;
        })}
      </div>
    </article>
  );
}

/** Overlapping avatars of the first project members, with the rest as a count. */
function MemberStack({ members }: { members: { userId: string; name: string }[] }) {
  if (members.length === 0) return null;
  const shown = members.slice(0, STACK_SIZE);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center" title={members.map((m) => m.name).join(", ")}>
      <span className="sr-only">{members.length} members</span>
      {shown.map((m, i) => (
        <PersonAvatar key={m.userId} name={m.name} size="md" className={cn("ring-2 ring-background", i > 0 && "-ml-1.5")} />
      ))}
      {rest > 0 && (
        <span aria-hidden className="ml-1.5 text-xs text-muted-foreground">
          +{rest}
        </span>
      )}
    </div>
  );
}

/**
 * The board's search box. It keeps a draft and hands it to `onCommit` after
 * 250 ms without typing. The URL is the source of truth: when `value` changes
 * to something this box did not push (back/forward, Clear filters), the draft
 * resets to it.
 */
function BoardSearch({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [draft, setDraft] = useState(value);
  // The last `q` this box pushed; its arrival must not reset a draft that may be newer.
  const [pushed, setPushed] = useState<string | undefined>(undefined);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!isOwnPush(value, pushed)) {
      setDraft(value);
      setPushed(undefined);
    }
  }

  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const q = draft.trim();
    if (q === value) return;
    const timer = setTimeout(() => {
      setPushed(q);
      commit.current(q);
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <label className="flex h-8 w-full items-center gap-2 border bg-card px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:w-60">
      <Search className="size-3.5 shrink-0" aria-hidden />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Filter systems"
        aria-label="Filter systems"
        className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}
