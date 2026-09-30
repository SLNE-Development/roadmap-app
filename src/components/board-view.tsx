"use client";

import { ArrowRightLeft, Ban, ChevronDown, ChevronsLeft, Ellipsis, List, Lock, PieChart, Plus, Search, SquareKanban, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveSystemAction } from "@/app/(app)/p/[project]/actions";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { PageHeader, ProgressBar } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
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
import { PRIORITIES, type ColumnCategory, type Priority } from "@/db/schema";
import { cn } from "@/lib/utils";
import { CATEGORY_CLASS, CategoryDot, PriorityTag } from "./chips";

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
  ownerUserId: string | null;
  ownerName: string | null;
  domainId: string | null;
  phaseId: string | null;
  columnId: string;
  planningComplete: boolean;
  tasksDone: number;
  tasksTotal: number;
  /** Summary of the system's newest update; shown as the reason while it is blocked. */
  latestSummary: string | null;
}

/** A named option of a filter (domain, phase, member). */
interface NamedOption {
  id: string;
  name: string;
}

/** The chip filters of the board; `owner` is a user id or `none`. */
interface BoardFilters {
  domain: string | null;
  phase: string | null;
  priority: string | null;
  owner: string | null;
}

const NO_FILTERS: BoardFilters = { domain: null, phase: null, priority: null, owner: null };

/** Most avatars shown in the header's member stack. */
const STACK_SIZE = 5;

/**
 * The board page body: header with members, view toggle and actions, a filter
 * bar, and the kanban over the board's columns. Dragging a card onto a column,
 * or choosing one in the card's menu, moves the system; the server enforces the
 * planning gate and a refusal restores the card with a toast.
 */
export function BoardView({
  projectSlug,
  projectName,
  board,
  boards,
  canEdit,
  canOwn,
  members,
  domains,
  phases,
  columns,
  cards,
}: {
  projectSlug: string;
  projectName: string;
  board: { slug: string; name: string };
  boards: { slug: string; name: string }[];
  canEdit: boolean;
  canOwn: boolean;
  members: { userId: string; name: string }[];
  domains: NamedOption[];
  phases: NamedOption[];
  columns: BoardColumnView[];
  cards: BoardCardView[];
}) {
  const [newSystemOpen, setNewSystemOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [optimistic, moveOptimistic] = useOptimistic(cards, (state, move: { slug: string; columnId: string }) =>
    state.map((c) => (c.slug === move.slug ? { ...c, columnId: move.columnId } : c)),
  );

  const domainName = useMemo(() => new Map(domains.map((d) => [d.id, d.name])), [domains]);
  const categoryOf = useMemo(() => new Map(columns.map((c) => [c.id, c.category])), [columns]);

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

  const needle = query.trim().toLowerCase();
  const visible = optimistic.filter(
    (c) =>
      (!needle || c.title.toLowerCase().includes(needle)) &&
      (!filters.domain || c.domainId === filters.domain) &&
      (!filters.phase || c.phaseId === filters.phase) &&
      (!filters.priority || c.priority === filters.priority) &&
      (!filters.owner || (filters.owner === "none" ? c.ownerUserId === null : c.ownerUserId === filters.owner)),
  );
  const blocked = visible.filter((c) => categoryOf.get(c.columnId) === "blocked").length;
  const planning = visible.filter((c) => categoryOf.get(c.columnId) === "planning").length;
  const draggedFrom = dragging ? optimistic.find((c) => c.slug === dragging)?.columnId : undefined;

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

  const toggle = (columnId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });

  /** Opens the header's New system dialog, which creates the system in planning. */
  const openNewSystem = () => setNewSystemOpen(true);

  const setFilter = (key: keyof BoardFilters) => (value: string | null) => setFilters((f) => ({ ...f, [key]: value }));
  const ownerOptions: NamedOption[] = [...members.map((m) => ({ id: m.userId, name: m.name })), { id: "none", name: "Unowned" }];

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
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-full items-center gap-2 border bg-card px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:w-60">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter systems"
            aria-label="Filter systems"
            className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {domains.length > 0 && <FilterChip label="Domain" options={domains} value={filters.domain} onChange={setFilter("domain")} />}
        {phases.length > 0 && <FilterChip label="Phase" options={phases} value={filters.phase} onChange={setFilter("phase")} />}
        <FilterChip
          label="Priority"
          options={PRIORITIES.map((p) => ({ id: p, name: p }))}
          value={filters.priority}
          onChange={setFilter("priority")}
        />
        <FilterChip label="Owner" options={ownerOptions} value={filters.owner} onChange={setFilter("owner")} />
        <span className="ml-auto text-[12.5px] text-muted-foreground" aria-live="polite">
          {visible.length} {visible.length === 1 ? "system" : "systems"} ·{" "}
          <span className={cn(blocked > 0 && "font-semibold text-cat-blocked")}>{blocked} blocked</span> · {planning} in planning
        </span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-9 lg:px-9" aria-busy={pending}>
        <div className="flex min-h-[calc(100dvh-15rem)] w-max items-stretch gap-3">
          {columns.map((col) => {
            const items = visible.filter((c) => c.columnId === col.id);
            const isOver = dragOver === col.id && draggedFrom !== undefined && draggedFrom !== col.id;

            if (col.category === "done" && !expanded.has(col.id)) {
              return (
                <section key={col.id} aria-label={`${col.name}, collapsed`} {...dropTarget(col.id)} className="flex w-10 shrink-0">
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
              <section key={col.id} aria-label={col.name} {...dropTarget(col.id)} className="flex w-[228px] shrink-0 flex-col gap-2 bg-column p-2">
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
                {items.map((c) => (
                  <SystemCard
                    key={c.slug}
                    card={c}
                    category={col.category}
                    domain={c.domainId ? (domainName.get(c.domainId) ?? null) : null}
                    projectSlug={projectSlug}
                    columns={columns}
                    canEdit={canEdit}
                    pending={pending}
                    dragging={dragging === c.slug}
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
                ))}
                {isOver ? (
                  <div className="flex h-16 shrink-0 items-center justify-center border-[1.5px] border-dashed border-primary bg-brand-soft text-xs font-medium text-brand-strong">
                    Drop to move to {col.name}
                  </div>
                ) : (
                  items.length === 0 && (
                    <div className="flex h-16 shrink-0 items-center justify-center border border-dashed text-xs text-muted-foreground">No systems</div>
                  )
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** One system on the board: domain, priority, title, blocker or planning state or progress, and owner. */
function SystemCard({
  card,
  category,
  domain,
  projectSlug,
  columns,
  canEdit,
  pending,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: BoardCardView;
  category: ColumnCategory;
  domain: string | null;
  projectSlug: string;
  columns: BoardColumnView[];
  canEdit: boolean;
  pending: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (columnId: string) => void;
}) {
  return (
    <article
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "flex flex-col gap-2 border bg-card p-3 shadow-[0_1px_0_color-mix(in_oklch,var(--foreground),transparent_96%)] transition-[transform,box-shadow]",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "rotate-[1.5deg] border-primary opacity-90 shadow-lg",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{domain ?? "No domain"}</span>
        <PriorityTag priority={card.priority} />
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
      {category === "blocked" && card.latestSummary && (
        <p className="flex items-start gap-1.5 bg-cat-blocked-soft px-2 py-1.5 text-xs leading-[1.4] text-cat-blocked">
          <Ban className="mt-px size-[13px] shrink-0" aria-hidden />
          <span className="line-clamp-3">{card.latestSummary}</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        {category === "planning" ? (
          <span className="flex flex-1 items-center gap-1.5 text-[11.5px] text-cat-planning">
            <PieChart className="size-[13px]" aria-hidden />
            {card.planningComplete ? "Interview complete" : "Planning open"}
          </span>
        ) : card.tasksTotal > 0 ? (
          <>
            <ProgressBar value={card.tasksDone} total={card.tasksTotal} colorClass={CATEGORY_CLASS[category]} />
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {card.tasksDone}/{card.tasksTotal}
            </span>
          </>
        ) : (
          <span className="flex-1 text-[11.5px] text-muted-foreground">No tasks</span>
        )}
        {card.ownerName && (
          <span title={card.ownerName} className="flex">
            <PersonAvatar name={card.ownerName} size="sm" className="ring-2 ring-card" />
            <span className="sr-only">Owner: {card.ownerName}</span>
          </span>
        )}
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
 * A filter chip over a list of options: dashed while empty, a Tide chip with
 * `Label: value` and a clear button while set.
 */
function FilterChip({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: NamedOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = options.find((o) => o.id === value);
  const chip = "flex h-8 items-center gap-1.5 px-2.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <div className={cn("flex items-center border", selected ? "border-primary bg-brand-soft text-brand-strong" : "border-dashed text-fg-2")}>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(chip, selected ? "pr-1.5 font-medium" : "hover:text-foreground")}>
          {selected ? `${label}: ${selected.name}` : label}
          {!selected && <ChevronDown className="size-3" aria-hidden />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id}>
                {o.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected && (
        <button type="button" aria-label={`Clear ${label.toLowerCase()} filter`} onClick={() => onChange(null)} className={cn(chip, "px-1.5 pl-0.5")}>
          <X className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
