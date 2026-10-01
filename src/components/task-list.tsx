"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowRightLeft, ArrowUp, Check, Gauge, GripVertical, ListChecks, Lock, Minus, Plus, StickyNote, TrashIcon, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoveTaskDialog } from "@/components/move-task-dialog";
import { ProgressBar } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { MentionTextarea } from "@/components/mentions/mention-textarea";
import { TASK_ESTIMATES, TASK_STATES, type ColumnCategory, type TaskEstimate, type TaskState } from "@/db/schema";
import { formatAdrNumber } from "@/lib/adr-number";
import type { CodeLinkView } from "@/lib/ops/github-links";
import type { TaskItem } from "@/lib/ops/systems";
import { rollup } from "@/lib/rollup";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { CATEGORY_CLASS, CATEGORY_TEXT, CategoryDot, STATE_CATEGORY } from "./chips";
import { PersonAvatar } from "./person-avatar";

/** Above this many tasks, done tasks start hidden behind a "Show N done" toggle. */
const COLLAPSE_AT = 8;

/** Border and text colour of the state box of each unfinished state (literal strings for Tailwind). */
const BOX_OPEN: Record<Exclude<TaskState, "done">, string> = {
  todo: "border-cat-todo text-cat-todo",
  doing: "border-cat-active text-cat-active",
  blocked: "border-cat-blocked text-cat-blocked",
};

/** Chip colours of a linked pull request by state (literal strings for Tailwind). */
const CODE_CHIP: Record<CodeLinkView["state"], string> = {
  open: "bg-cat-active-soft text-cat-active",
  merged: "bg-cat-done-soft text-cat-done",
  closed: "bg-cat-todo-soft text-cat-todo",
};

/** The glyph inside a state box: a check, clock hands, a dash or nothing. */
function StateGlyph({ state }: { state: TaskState }) {
  if (state === "done") return <Check aria-hidden className="size-3 lg:size-[11px]" strokeWidth={3.2} />;
  if (state === "blocked") return <Minus aria-hidden className="size-3 lg:size-[11px]" strokeWidth={3.2} />;
  if (state === "doing") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="size-3 lg:size-[11px]" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  return null;
}

/** Classes of the square state box of a task. */
function boxClass(state: TaskState): string {
  return cn(
    "flex size-6 shrink-0 items-center justify-center lg:size-[18px]",
    state === "done" ? "bg-cat-done text-background" : cn("border-[1.5px]", BOX_OPEN[state]),
  );
}

/** The read-only square state box of a task, for lists outside the task list. */
export function TaskStateBox({ state }: { state: TaskState }) {
  const t = useTranslations("tasks.row");
  const te = useTranslations("enums.taskState");
  return (
    <span role="img" aria-label={t("stateLabel", { state: te(state) })} className={boxClass(state)}>
      <StateGlyph state={state} />
    </span>
  );
}

/**
 * A dialog with one textarea. Save is disabled while the text is empty and `required`,
 * or while saving; without `onSave` (viewers) the text is read-only.
 *
 * @param props.draft the text being edited, owned by the caller so it can be prefilled on open
 * @param props.onSave saves the draft; omit for a read-only dialog
 * @param props.mentionsIn the project slug whose members `@` suggests while editing; omit for plain text
 */
function TextDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  draft,
  onDraftChange,
  maxLength,
  required,
  saving,
  onSave,
  mentionsIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  draft: string;
  onDraftChange: (text: string) => void;
  maxLength: number;
  required?: boolean;
  saving?: boolean;
  onSave?: () => void;
  mentionsIn?: string;
}) {
  const t = useTranslations("tasks.dialog");
  const empty = required && !draft.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (onSave && !saving && !empty) onSave();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {mentionsIn && onSave ? (
            <MentionTextarea
              aria-label={label}
              placeholder={label}
              projectSlug={mentionsIn}
              value={draft}
              maxLength={maxLength}
              required={required}
              rows={6}
              onValueChange={onDraftChange}
            />
          ) : (
            <Textarea
              aria-label={label}
              placeholder={label}
              value={draft}
              maxLength={maxLength}
              required={required}
              readOnly={!onSave}
              rows={6}
              onChange={(e) => onDraftChange(e.target.value)}
            />
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {onSave ? t("cancel") : t("close")}
              </Button>
            </DialogClose>
            {onSave && (
              <Button type="submit" disabled={saving || empty}>
                {t("save")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The expanded checklist under a task row: a checkbox and remove button per item, and an add field for editors. */
function Checklist({ task, canEdit }: { task: TaskItem; canEdit: boolean }) {
  const t = useTranslations("tasks.checklist");
  const trpc = useTRPC();
  const add = useMutation(trpc.tasks.checks.add.mutationOptions());
  const update = useMutation(trpc.tasks.checks.update.mutationOptions());
  const remove = useMutation(trpc.tasks.checks.delete.mutationOptions());
  const [title, setTitle] = useState("");
  const pending = add.isPending;
  return (
    <div className="flex flex-col pb-1 pl-9 sm:pl-[68px]">
      <ul aria-label={t("label", { task: task.title })} className="flex flex-col">
        {task.checks.map((c) => (
          <li key={c.id} className="flex min-h-9 items-center gap-3 py-1 lg:min-h-0">
            <Checkbox
              aria-label={c.title}
              checked={c.done}
              disabled={!canEdit || update.isPending}
              onCheckedChange={(v) => update.mutate({ id: c.id, patch: { done: v === true } })}
            />
            <span className={cn("min-w-0 flex-1 text-sm lg:text-[13px]", c.done && "text-muted-foreground line-through")}>{c.title}</span>
            {canEdit && (
              <button
                type="button"
                aria-label={t("remove", { item: c.title })}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: c.id })}
                className="flex size-6 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X aria-hidden className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          aria-busy={pending}
          className="flex min-h-9 items-center gap-3 py-1 text-muted-foreground focus-within:text-foreground lg:min-h-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending || !title.trim()) return;
            add.mutate({ taskId: task.id, check: { title: title.trim() } }, { onSuccess: () => setTitle("") });
          }}
        >
          <Plus aria-hidden className="size-4 shrink-0" />
          <input
            aria-label={t("addLabel", { task: task.title })}
            placeholder={t("add")}
            value={title}
            maxLength={200}
            readOnly={pending}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground lg:text-[13px]"
          />
        </form>
      )}
    </div>
  );
}

/** What a row needs to be reordered: arrow availability and the drag-and-drop state and handlers. */
interface RowOrder {
  canUp: boolean;
  canDown: boolean;
  onShift: (delta: -1 | 1) => void;
  dragging: boolean;
  over: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/** One task row: drag handle and state box (a menu) for editors, plan step, title, owner and state label. */
function TaskRow({
  task,
  projectSlug,
  systemSlug,
  members,
  canEdit,
  planningComplete,
  order,
  code,
}: {
  task: TaskItem;
  projectSlug: string;
  systemSlug: string;
  members: { userId: string; name: string }[];
  canEdit: boolean;
  planningComplete: boolean;
  order: RowOrder;
  /** The pull requests linked to this task. */
  code: CodeLinkView[];
}) {
  const t = useTranslations("tasks.row");
  const te = useTranslations("enums.taskState");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const update = useMutation(trpc.tasks.update.mutationOptions());
  // A deleted task's row unmounts, so the toast lives on the mutation.
  const remove = useMutation(trpc.tasks.delete.mutationOptions({ onSuccess: () => toast.success(t("deleted")) }));
  const pending = update.isPending || remove.isPending;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [checksOpen, setChecksOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const checksDone = task.checks.filter((c) => c.done).length;
  // The drafts are prefilled when a dialog opens, from the event handler.
  const openBlock = () => {
    setReason(task.blockedReason ?? "");
    setBlockOpen(true);
  };
  const openNotes = () => {
    setNotes(task.notes);
    setNotesOpen(true);
  };
  const locked = (s: TaskState) => !planningComplete && (s === "doing" || s === "done");
  const category = STATE_CATEGORY[task.state];
  const label = te(task.state);

  return (
    <li
      id={`task-${task.id}`}
      className={cn("flex flex-col border-t px-4 sm:px-[18px] target:bg-muted", order.dragging && "opacity-50", order.over && "bg-muted")}
      aria-busy={pending}
      onDragOver={order.onDragOver}
      onDragLeave={order.onDragLeave}
      onDrop={order.onDrop}
    >
      <div className="flex min-h-12 items-center gap-3 py-2 lg:min-h-0 lg:py-2.5">
        {canEdit && (
          <span
            draggable
            aria-hidden
            title={t("dragToReorder")}
            onDragStart={order.onDragStart}
            onDragEnd={order.onDragEnd}
            className="-mr-1 flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </span>
        )}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={pending}>
              <button
                type="button"
                aria-label={t("changeState", { state: label, task: task.title })}
                className={cn(boxClass(task.state), "outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
              >
                <StateGlyph state={task.state} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>{t("state")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={task.state}
                onValueChange={(v) => {
                  if (v !== "blocked")
                    update.mutate({
                      id: task.id,
                      patch: { state: v as TaskState },
                    });
                }}
              >
                {TASK_STATES.map((s) => (
                  <DropdownMenuRadioItem key={s} value={s} disabled={locked(s)} onSelect={s === "blocked" ? openBlock : undefined}>
                    <CategoryDot category={STATE_CATEGORY[s]} />
                    {s === "blocked" ? t("blockedEllipsis") : te(s)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {!planningComplete && (
                <p className="flex gap-2 px-1.5 py-1 text-xs leading-normal text-cat-planning">
                  <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {t("planningLocked")}
                </p>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserRound />
                  {t("owner")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuRadioGroup
                    value={task.ownerUserId ?? ""}
                    onValueChange={(v) => {
                      const name = members.find((m) => m.userId === v)?.name;
                      update.mutate(
                        { id: task.id, patch: { ownerUserId: v || null } },
                        {
                          onSuccess: () => toast.success(name ? t("ownerSet", { name, task: task.title }) : t("ownerCleared", { task: task.title })),
                        },
                      );
                    }}
                  >
                    <DropdownMenuRadioItem value="">{t("nobody")}</DropdownMenuRadioItem>
                    {members.map((m) => (
                      <DropdownMenuRadioItem key={m.userId} value={m.userId}>
                        {m.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Gauge />
                  {t("estimate")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  <DropdownMenuRadioGroup
                    value={task.estimate ?? ""}
                    onValueChange={(v) =>
                      update.mutate({
                        id: task.id,
                        patch: { estimate: (v || null) as TaskEstimate | null },
                      })
                    }
                  >
                    <DropdownMenuRadioItem value="">{tc("none")}</DropdownMenuRadioItem>
                    {TASK_ESTIMATES.map((e) => (
                      <DropdownMenuRadioItem key={e} value={e}>
                        {e}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {task.checks.length === 0 && (
                <DropdownMenuItem onSelect={() => setChecksOpen(true)}>
                  <ListChecks />
                  {t("addChecklist")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={openNotes}>
                <StickyNote />
                {t("notes")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!order.canUp} onSelect={() => order.onShift(-1)}>
                <ArrowUp />
                {t("moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!order.canDown} onSelect={() => order.onShift(1)}>
                <ArrowDown />
                {t("moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                <ArrowRightLeft />
                {t("moveToSystem")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <TrashIcon />
                {t("deleteTask")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span role="img" aria-label={t("stateLabel", { state: label })} className={boxClass(task.state)}>
            <StateGlyph state={task.state} />
          </span>
        )}
        <span className="hidden w-[26px] shrink-0 font-mono text-[11.5px] text-muted-foreground sm:inline">
          {task.planStep !== null ? `#${task.planStep}` : ""}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("text-sm lg:text-[13.5px]", task.state === "done" && "text-muted-foreground line-through")}>{task.title}</span>
          {task.state === "blocked" && task.blockedReason && <span className="text-xs text-cat-blocked">{task.blockedReason}</span>}
          {code.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1.5">
              {code.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn("inline-flex items-center gap-1 px-1.5 font-mono text-[11px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50", CODE_CHIP[l.state])}
                >
                  {t("pullRequest", { number: l.number ?? 0 })}
                  {l.checks === "failure" && <span role="img" aria-label={t("checksFailing")} title={t("checksFailing")} className="size-1.5 rounded-full bg-cat-blocked" />}
                </a>
              ))}
            </span>
          )}
          {task.adrs.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1.5">
              {task.adrs.map((n) => (
                <Link
                  key={n}
                  href={`/p/${projectSlug}/adrs/${n}`}
                  className="border px-1.5 font-mono text-[11px] text-fg-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {`ADR-${formatAdrNumber(n)}`}
                </Link>
              ))}
            </span>
          )}
        </span>
        {task.checks.length > 0 && (
          <button
            type="button"
            aria-label={t("checklistProgress", { task: task.title, done: checksDone, total: task.checks.length })}
            aria-expanded={checksOpen}
            onClick={() => setChecksOpen((v) => !v)}
            className="shrink-0 border px-1.5 font-mono text-[11px] text-fg-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {checksDone}/{task.checks.length}
          </button>
        )}
        {task.notes && (
          <button
            type="button"
            aria-label={t("notesFor", { task: task.title })}
            onClick={openNotes}
            className="flex size-6 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <StickyNote aria-hidden className="size-4" />
          </button>
        )}
        {task.estimate && (
          <span title={t("estimateValue", { value: task.estimate })} className="shrink-0 border px-1.5 font-mono text-[11px] text-fg-2">
            {task.estimate}
          </span>
        )}
        <span className="hidden size-[22px] shrink-0 sm:inline-flex" title={task.ownerName ?? t("noOwner")}>
          {task.ownerName && <PersonAvatar name={task.ownerName} size="sm" />}
        </span>
        <span className={cn("hidden w-[72px] shrink-0 text-right text-xs font-semibold sm:inline", CATEGORY_TEXT[category])}>{label}</span>
      </div>
      {checksOpen && <Checklist task={task} canEdit={canEdit} />}
      {canEdit && (
        <TextDialog
          open={blockOpen}
          onOpenChange={setBlockOpen}
          title={t("blockTitle")}
          description={task.title}
          label={t("blockLabel")}
          draft={reason}
          onDraftChange={setReason}
          maxLength={300}
          required
          saving={update.isPending}
          onSave={() =>
            update.mutate(
              {
                id: task.id,
                patch: { state: "blocked", blockedReason: reason.trim() },
              },
              { onSuccess: () => setBlockOpen(false) },
            )
          }
        />
      )}
      <TextDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        title={t("notes")}
        description={task.title}
        label={t("notes")}
        draft={notes}
        onDraftChange={setNotes}
        maxLength={5000}
        mentionsIn={projectSlug}
        saving={update.isPending}
        onSave={canEdit ? () => update.mutate({ id: task.id, patch: { notes } }, { onSuccess: () => setNotesOpen(false) }) : undefined}
      />
      {canEdit && <MoveTaskDialog open={moveOpen} onOpenChange={setMoveOpen} projectSlug={projectSlug} systemSlug={systemSlug} task={task} />}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{task.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate({ id: task.id })}>
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * The Tasks panel: progress, the tasks with a square state box each (a state,
 * owner, order, move and delete menu and a drag handle for editors), and an inline add field. With many
 * tasks, done ones start hidden. While planning is open, doing and done are disabled.
 *
 * @param props.category the system's column category, which colours the progress bar
 */
export function TaskList({
  projectSlug,
  systemSlug,
  tasks,
  members,
  canEdit,
  planningComplete,
  category,
  code = [],
}: {
  projectSlug: string;
  systemSlug: string;
  tasks: TaskItem[];
  members: { userId: string; name: string }[];
  canEdit: boolean;
  planningComplete: boolean;
  category: ColumnCategory;
  /** The system's code links; pull requests of a task get a chip on its row. */
  code?: CodeLinkView[];
}) {
  const t = useTranslations("tasks.list");
  const trpc = useTRPC();
  const add = useMutation(trpc.tasks.add.mutationOptions());
  const reorder = useMutation(trpc.tasks.reorder.mutationOptions());
  const pending = add.isPending;
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { done, points, pointsDone, unestimated } = rollup(tasks);
  const collapsible = tasks.length > COLLAPSE_AT && done > 0;
  const [showDone, setShowDone] = useState(!collapsible);
  const [ordering, startOrdering] = useTransition();
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [ordered, setOrder] = useOptimistic(tasks, (state, ids: number[]) =>
    ids.flatMap((id) => state.find((task) => task.id === id) ?? []),
  );
  const visible = showDone ? ordered : ordered.filter((task) => task.state !== "done");

  /** Puts a task where the target task is and persists it; a refusal restores the order and shows why. */
  const place = (id: number, targetId: number) => {
    if (!canEdit || ordering || id === targetId) return;
    const ids = ordered.map((task) => task.id).filter((x) => x !== id);
    ids.splice(ordered.findIndex((task) => task.id === targetId), 0, id);
    startOrdering(async () => {
      setOrder(ids);
      // A refusal is toasted by the mutation cache; the rows fall back once the transition ends.
      await reorder.mutateAsync({ project: projectSlug, system: systemSlug, orderedIds: ids }).catch(() => undefined);
    });
  };

  return (
    <section className="flex flex-col border bg-card">
      <header className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3.5 sm:px-[18px] sm:py-4">
        <h2 className="font-display text-[19px] font-semibold">{t("title")}</h2>
        {tasks.length > 0 && (
          <>
            <span className="text-[13px] text-fg-2 tabular-nums">
              {t("progress", { done, total: tasks.length })}
            </span>
            <ProgressBar value={done} total={tasks.length} colorClass={CATEGORY_CLASS[category]} className="h-1.5 max-w-[200px]" />
            {points > 0 && (
              <span className="text-[13px] text-fg-2 tabular-nums">
                {t("points", { done: pointsDone, total: points })}
              </span>
            )}
            {unestimated > 0 && <span className="text-[13px] text-muted-foreground tabular-nums">{t("unestimated", { count: unestimated })}</span>}
          </>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="ml-auto text-[13px] font-medium text-brand-strong hover:underline"
          >
            {showDone ? t("hideDone") : t("showDone", { count: done })}
          </button>
        )}
      </header>
      {!planningComplete && (
        <p className="flex items-center gap-2 border-t bg-cat-planning-soft px-4 py-2 text-[12.5px] text-cat-planning sm:px-[18px]">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          {t("planningLocked")}
        </p>
      )}
      <ul className="flex flex-col">
        {visible.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            projectSlug={projectSlug}
            systemSlug={systemSlug}
            members={members}
            canEdit={canEdit}
            planningComplete={planningComplete}
            code={code.filter((l) => l.kind === "pr" && l.taskId === task.id)}
            order={{
              canUp: i > 0 && !ordering,
              canDown: i < visible.length - 1 && !ordering,
              onShift: (delta) => place(task.id, visible[i + delta].id),
              dragging: dragging === task.id,
              over: dragOver === task.id && dragging !== task.id,
              onDragStart: (e) => {
                const row = e.currentTarget.closest("li");
                if (row) e.dataTransfer.setDragImage(row, 0, 0);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(task.id));
                setDragging(task.id);
              },
              onDragEnd: () => {
                setDragging(null);
                setDragOver(null);
              },
              onDragOver: (e) => {
                if (!canEdit || dragging === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOver !== task.id) setDragOver(task.id);
              },
              onDragLeave: (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver((v) => (v === task.id ? null : v));
              },
              onDrop: (e) => {
                e.preventDefault();
                const from = dragging;
                setDragging(null);
                setDragOver(null);
                if (from !== null) place(from, task.id);
              },
            }}
          />
        ))}
        {tasks.length === 0 && (
          <li className="border-t px-4 py-6 text-center text-[13px] text-fg-2 sm:px-[18px]">
            {canEdit ? t("emptyEditable") : t("empty")}
          </li>
        )}
      </ul>
      {canEdit && (
        <form
          aria-busy={pending}
          className="flex min-h-12 items-center gap-3 border-t px-4 py-2 text-muted-foreground focus-within:text-foreground sm:px-[18px] lg:min-h-0 lg:py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending || !title.trim()) return;
            add.mutate(
              {
                project: projectSlug,
                system: systemSlug,
                task: { title: title.trim() },
              },
              {
                onSuccess: () => {
                  setTitle("");
                  inputRef.current?.focus();
                },
              },
            );
          }}
        >
          <Plus aria-hidden className="size-[18px] shrink-0" />
          <input
            aria-label={t("addTask")}
            placeholder={t("addTask")}
            ref={inputRef}
            value={title}
            readOnly={pending}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground lg:text-[13.5px]"
          />
          <Kbd className="hidden border bg-transparent font-mono text-[11px] sm:inline-flex">{t("enter")}</Kbd>
        </form>
      )}
    </section>
  );
}
