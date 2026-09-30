"use client";

import { TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addTaskAction, deleteTaskAction, updateTaskAction } from "@/app/(app)/p/[project]/actions";
import type { ActionResult } from "@/app/actions/run";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TASK_STATES, type TaskState } from "@/db/schema";
import type { TaskItem } from "@/lib/ops/systems";
import { cn } from "@/lib/utils";
import { TaskStateBadge } from "./chips";

/**
 * The system's tasks with state and owner menus, deletion and an add form. While
 * planning is open, the doing and done states are disabled.
 */
export function TaskList({
  projectSlug,
  systemSlug,
  tasks,
  members,
  canEdit,
  planningComplete,
}: {
  projectSlug: string;
  systemSlug: string;
  tasks: TaskItem[];
  members: { userId: string; name: string }[];
  canEdit: boolean;
  planningComplete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");

  /** Runs an action and toasts its error. */
  const act = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
      else after?.();
    });

  const done = tasks.filter((t) => t.state === "done").length;
  const locked = (s: TaskState) => !planningComplete && (s === "doing" || s === "done");

  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription>{planningComplete ? "Starting a task makes you its owner." : "Tasks can start once planning is complete."}</CardDescription>
        <CardAction className="text-sm text-muted-foreground tabular-nums">
          {done}/{tasks.length} done
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="divide-y rounded-md border">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              {t.planStep !== null && <span className="font-mono text-xs text-muted-foreground">#{t.planStep}</span>}
              <span className={cn("min-w-40 flex-1", t.state === "done" && "text-muted-foreground line-through")}>{t.title}</span>
              {canEdit ? (
                <>
                  <NativeSelect
                    size="sm"
                    aria-label={`State of ${t.title}`}
                    value={t.state}
                    disabled={pending}
                    onChange={(e) => act(() => updateTaskAction(t.id, { state: e.target.value as TaskState }))}
                  >
                    {TASK_STATES.map((s) => (
                      <NativeSelectOption key={s} value={s} disabled={locked(s)}>
                        {s}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    size="sm"
                    aria-label={`Owner of ${t.title}`}
                    value={t.ownerUserId ?? ""}
                    disabled={pending}
                    onChange={(e) => act(() => updateTaskAction(t.id, { ownerUserId: e.target.value || null }))}
                  >
                    <NativeSelectOption value="">Unowned</NativeSelectOption>
                    {members.map((m) => (
                      <NativeSelectOption key={m.userId} value={m.userId}>
                        {m.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${t.title}`}>
                        <TrashIcon />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                        <AlertDialogDescription>{t.title}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => act(() => deleteTaskAction(t.id))}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                <>
                  <TaskStateBadge state={t.state} />
                  <span className="text-sm text-muted-foreground">{t.ownerName ?? "Unowned"}</span>
                </>
              )}
            </li>
          ))}
          {tasks.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No tasks yet.</li>}
        </ul>
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () => addTaskAction(projectSlug, systemSlug, { title }),
                () => setTitle(""),
              );
            }}
          >
            <Input aria-label="New task" placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" variant="outline" disabled={pending || !title.trim()}>
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
