"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Lock, Minus, Plus, TrashIcon, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { TASK_STATES, type ColumnCategory, type TaskState } from "@/db/schema";
import type { TaskItem } from "@/lib/ops/systems";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { CATEGORY_CLASS, CATEGORY_TEXT, CategoryDot, STATE_CATEGORY, STATE_LABEL } from "./chips";
import { PersonAvatar } from "./person-avatar";

/** Above this many tasks, done tasks start hidden behind a "Show N done" toggle. */
const COLLAPSE_AT = 8;

/** Border and text colour of the state box of each unfinished state (literal strings for Tailwind). */
const BOX_OPEN: Record<Exclude<TaskState, "done">, string> = {
  todo: "border-cat-todo text-cat-todo",
  doing: "border-cat-active text-cat-active",
  blocked: "border-cat-blocked text-cat-blocked",
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

/** One task row: state box (a menu for editors), plan step, title, owner and state label. */
function TaskRow({
  task,
  members,
  canEdit,
  planningComplete,
}: {
  task: TaskItem;
  members: { userId: string; name: string }[];
  canEdit: boolean;
  planningComplete: boolean;
}) {
  const trpc = useTRPC();
  const update = useMutation(trpc.tasks.update.mutationOptions());
  // A deleted task's row unmounts, so the toast lives on the mutation.
  const remove = useMutation(trpc.tasks.delete.mutationOptions({ onSuccess: () => toast.success("Task deleted") }));
  const pending = update.isPending || remove.isPending;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = (s: TaskState) => !planningComplete && (s === "doing" || s === "done");
  const category = STATE_CATEGORY[task.state];
  const label = STATE_LABEL[task.state];

  return (
    <li className="flex min-h-12 items-center gap-3 border-t px-4 py-2 sm:px-[18px] lg:min-h-0 lg:py-2.5" aria-busy={pending}>
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={pending}>
            <button
              type="button"
              aria-label={`Task state: ${label}. Change state of ${task.title}`}
              className={cn(boxClass(task.state), "outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
            >
              <StateGlyph state={task.state} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>State</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={task.state}
              onValueChange={(v) => update.mutate({ id: task.id, patch: { state: v as TaskState } })}
            >
              {TASK_STATES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s} disabled={locked(s)}>
                  <CategoryDot category={STATE_CATEGORY[s]} />
                  {STATE_LABEL[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {!planningComplete && (
              <p className="flex gap-2 px-1.5 py-1 text-xs leading-normal text-cat-planning">
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Tasks can start once planning is complete.
              </p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserRound />
                Owner
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuRadioGroup
                  value={task.ownerUserId ?? ""}
                  onValueChange={(v) => {
                    const name = members.find((m) => m.userId === v)?.name;
                    update.mutate(
                      { id: task.id, patch: { ownerUserId: v || null } },
                      { onSuccess: () => toast.success(name ? `${name} owns “${task.title}”` : `“${task.title}” has no owner`) },
                    );
                  }}
                >
                  <DropdownMenuRadioItem value="">Nobody</DropdownMenuRadioItem>
                  {members.map((m) => (
                    <DropdownMenuRadioItem key={m.userId} value={m.userId}>
                      {m.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <TrashIcon />
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span role="img" aria-label={`Task state: ${label}`} className={boxClass(task.state)}>
          <StateGlyph state={task.state} />
        </span>
      )}
      <span className="hidden w-[26px] shrink-0 font-mono text-[11.5px] text-muted-foreground sm:inline">
        {task.planStep !== null ? `#${task.planStep}` : ""}
      </span>
      <span className={cn("min-w-0 flex-1 text-sm lg:text-[13.5px]", task.state === "done" && "text-muted-foreground line-through")}>{task.title}</span>
      <span className="hidden size-[22px] shrink-0 sm:inline-flex" title={task.ownerName ?? "No owner"}>
        {task.ownerName && <PersonAvatar name={task.ownerName} size="sm" />}
      </span>
      <span className={cn("hidden w-14 shrink-0 text-right text-xs font-semibold sm:inline", CATEGORY_TEXT[category])}>{label}</span>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>{task.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate({ id: task.id })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * The Tasks panel: progress, the tasks with a square state box each (a state,
 * owner and delete menu for editors), and an inline add field. With many
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
}: {
  projectSlug: string;
  systemSlug: string;
  tasks: TaskItem[];
  members: { userId: string; name: string }[];
  canEdit: boolean;
  planningComplete: boolean;
  category: ColumnCategory;
}) {
  const trpc = useTRPC();
  const add = useMutation(trpc.tasks.add.mutationOptions());
  const pending = add.isPending;
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const done = tasks.filter((t) => t.state === "done").length;
  const collapsible = tasks.length > COLLAPSE_AT && done > 0;
  const [showDone, setShowDone] = useState(!collapsible);
  const visible = showDone ? tasks : tasks.filter((t) => t.state !== "done");

  return (
    <section className="flex flex-col border bg-card">
      <header className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3.5 sm:px-[18px] sm:py-4">
        <h2 className="font-display text-[19px] font-semibold">Tasks</h2>
        {tasks.length > 0 && (
          <>
            <span className="text-[13px] text-fg-2 tabular-nums">
              {done} of {tasks.length} done
            </span>
            <ProgressBar value={done} total={tasks.length} colorClass={CATEGORY_CLASS[category]} className="h-1.5 max-w-[200px]" />
          </>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="ml-auto text-[13px] font-medium text-brand-strong hover:underline"
          >
            {showDone ? "Hide done" : `Show ${done} done`}
          </button>
        )}
      </header>
      {!planningComplete && (
        <p className="flex items-center gap-2 border-t bg-cat-planning-soft px-4 py-2 text-[12.5px] text-cat-planning sm:px-[18px]">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          Tasks can start once planning is complete.
        </p>
      )}
      <ul className="flex flex-col">
        {visible.map((t) => (
          <TaskRow key={t.id} task={t} members={members} canEdit={canEdit} planningComplete={planningComplete} />
        ))}
        {tasks.length === 0 && (
          <li className="border-t px-4 py-6 text-center text-[13px] text-fg-2 sm:px-[18px]">
            No tasks yet. They come from the implementation plan{canEdit ? ", or add one below" : ""}.
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
              { project: projectSlug, system: systemSlug, task: { title: title.trim() } },
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
            aria-label="Add a task"
            placeholder="Add a task"
            ref={inputRef}
            value={title}
            readOnly={pending}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground lg:text-[13.5px]"
          />
          <Kbd className="hidden border bg-transparent font-mono text-[11px] sm:inline-flex">Enter</Kbd>
        </form>
      )}
    </section>
  );
}
