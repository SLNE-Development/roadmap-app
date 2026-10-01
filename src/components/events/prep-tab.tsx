"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { EmptyState, Panel } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TodoView } from "@/lib/ops/request-prep";
import { fromZonedInput, toZonedInput } from "@/lib/zoned-time";
import { useTRPC } from "@/trpc/client";

/** The to-do keys of the prep template, which have a translated title. */
const TEMPLATE_KEYS = ["team-message", "announcement", "build-ready", "rehearsal", "reminder", "recap"] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The to-dos of the Prep tab by when they are due. */
export interface TodoGroups {
  late: TodoView[];
  week: TodoView[];
  later: TodoView[];
  done: TodoView[];
}

/**
 * Splits to-dos into late (past due, not done), this week (due within seven days), later, and done. The open groups are
 * ordered by due date, the done group newest first.
 *
 * @param todos the to-dos with their `late` flag
 * @param now the moment "this week" counts from
 */
export function groupTodos(todos: TodoView[], now: Date): TodoGroups {
  const groups: TodoGroups = { late: [], week: [], later: [], done: [] };
  for (const todo of [...todos].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())) {
    if (todo.doneAt !== null) groups.done.push(todo);
    else if (todo.late) groups.late.push(todo);
    else if (todo.dueAt.getTime() - now.getTime() < WEEK_MS) groups.week.push(todo);
    else groups.later.push(todo);
  }
  groups.done.reverse();
  return groups;
}

/** The mutations the rows share, reduced to what the rows call. */
interface Actions {
  done: { isPending: boolean; mutate: (input: { todoId: string; done: boolean }) => void };
  update: { isPending: boolean; mutate: (input: { todoId: string; title?: string; ownerUserId?: string | null; dueAt?: Date }, options?: { onSuccess?: () => void }) => void };
  remove: { isPending: boolean; mutate: (input: { todoId: string }) => void };
}

/** What a row needs besides its to-do. */
interface RowProps {
  canEdit: boolean;
  owners: { id: string; name: string }[];
  now: Date;
  actions: Actions;
}

/** One to-do: checkbox, title, owner, due date, and edit and remove for people who may change the list. */
function TodoRow({ todo, canEdit, owners, now, actions }: RowProps & { todo: TodoView }) {
  const t = useTranslations("events.prep");
  const format = useFormatter();
  const zone = useTimeZone() ?? "UTC";
  const id = useId();
  const custom = todo.templateKey === null;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(() => toZonedInput(todo.dueAt, zone));
  const [owner, setOwner] = useState(todo.ownerUserId ?? "");
  const shownTitle = (TEMPLATE_KEYS as readonly string[]).includes(todo.templateKey ?? "") ? t(`template.${todo.templateKey as (typeof TEMPLATE_KEYS)[number]}`) : todo.title;
  const dueAt = fromZonedInput(due, zone);
  const absolute = format.dateTime(todo.dueAt, { dateStyle: "medium", timeStyle: "short" });
  if (editing) {
    return (
      <li className="flex flex-wrap items-end gap-3 bg-secondary/40 px-4 py-3 sm:px-5">
        {custom && (
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor={`${id}-title`}>{t("newTitle")}</FieldLabel>
            <Input id={`${id}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <Field className="w-auto">
          <FieldLabel htmlFor={`${id}-due`}>{t("due")}</FieldLabel>
          <Input id={`${id}-due`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor={`${id}-owner`}>{t("owner")}</FieldLabel>
          <NativeSelect id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <NativeSelectOption value="">{t("noOwner")}</NativeSelectOption>
            {owners.map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={actions.update.isPending || !dueAt || (custom && !title.trim())}
            onClick={() => {
              if (!dueAt) return;
              const patch = {
                ...(custom && title.trim() !== todo.title ? { title: title.trim() } : {}),
                ...(dueAt.getTime() !== todo.dueAt.getTime() ? { dueAt } : {}),
                ...(owner !== (todo.ownerUserId ?? "") ? { ownerUserId: owner || null } : {}),
              };
              if (Object.keys(patch).length === 0) setEditing(false);
              else actions.update.mutate({ todoId: todo.id, ...patch }, { onSuccess: () => setEditing(false) });
            }}
          >
            {t("save")}
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13.5px] sm:px-5">
      <label className="flex min-w-0 flex-1 basis-56 items-center gap-2.5">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={todo.doneAt !== null}
          disabled={!canEdit || actions.done.isPending}
          onChange={(e) => actions.done.mutate({ todoId: todo.id, done: e.target.checked })}
        />
        <span className={todo.doneAt ? "text-muted-foreground line-through" : "font-medium"}>{shownTitle}</span>
      </label>
      <div className="flex items-center gap-3 text-[12.5px] text-fg-2">
        {todo.ownerName ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center" tabIndex={0} aria-label={t("ownerIs", { name: todo.ownerName })}>
                <PersonAvatar name={todo.ownerName} size="sm" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{todo.ownerName}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">{t("noOwner")}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <time dateTime={todo.dueAt.toISOString()} tabIndex={0} className={todo.late ? "font-medium text-destructive" : undefined}>
              {todo.doneAt ? absolute : format.relativeTime(todo.dueAt, now)}
            </time>
          </TooltipTrigger>
          <TooltipContent>{absolute}</TooltipContent>
        </Tooltip>
        {canEdit && (
          <span className="flex">
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              <span className="sr-only">{t("edit", { title: shownTitle })}</span>
            </Button>
            {custom && (
              <Button type="button" size="icon-sm" variant="ghost" disabled={actions.remove.isPending} onClick={() => actions.remove.mutate({ todoId: todo.id })}>
                <Trash2 aria-hidden />
                <span className="sr-only">{t("removeTodo", { title: shownTitle })}</span>
              </Button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

/** One group of to-dos as a panel; the done group is collapsed until opened. */
function Group({ title, todos, collapsed, ...row }: RowProps & { title: string; todos: TodoView[]; collapsed?: boolean }) {
  if (todos.length === 0) return null;
  const list = (
    <ul className="flex flex-col divide-y border-t">
      {todos.map((todo) => (
        <TodoRow key={todo.id} todo={todo} {...row} />
      ))}
    </ul>
  );
  if (!collapsed) {
    return (
      <Panel title={title} meta={todos.length} bodyClassName="pb-0">
        {list}
      </Panel>
    );
  }
  return (
    <details className="group border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 select-none sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 text-fg-2 transition-transform group-open:rotate-90" />
        <h2 className="font-display text-[19px] font-semibold">{title}</h2>
        <span className="text-[12.5px] text-muted-foreground">{todos.length}</span>
      </summary>
      {list}
    </details>
  );
}

/**
 * The Prep tab: the to-dos grouped into late, this week, later and done (collapsed), each with owner and due date, and a
 * form at the bottom for more.
 *
 * @param props.requestId the request
 * @param props.canEdit whether the actor may add, change, tick and remove to-dos
 */
export function PrepTab({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const t = useTranslations("events.prep");
  const trpc = useTRPC();
  const zone = useTimeZone() ?? "UTC";
  const id = useId();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [owner, setOwner] = useState("");
  const [now] = useState(() => new Date());
  const [{ data: todos }, { data: owners }] = useSuspenseQueries({ queries: [trpc.requests.todos.queryOptions({ id: requestId }), trpc.requests.owners.queryOptions({ id: requestId })] });
  const done = useMutation(trpc.requests.setTodoDone.mutationOptions());
  const update = useMutation(trpc.requests.updateTodo.mutationOptions());
  const remove = useMutation(trpc.requests.removeTodo.mutationOptions());
  const add = useMutation(
    trpc.requests.addTodo.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setDue("");
        setOwner("");
      },
    }),
  );
  const dueDate = fromZonedInput(due, zone);
  const groups = groupTodos(todos, now);
  const row = { canEdit, owners, now, actions: { done, update, remove } };
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {todos.length === 0 && <EmptyState title={t("emptyTitle")} description={t("empty")} />}
      <Group title={t("groupLate")} todos={groups.late} {...row} />
      <Group title={t("groupWeek")} todos={groups.week} {...row} />
      <Group title={t("groupLater")} todos={groups.later} {...row} />
      <Group title={t("groupDone")} todos={groups.done} collapsed {...row} />
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-3 border border-dashed px-4 py-4 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (dueDate) add.mutate({ id: requestId, title, dueAt: dueDate, ownerUserId: owner || null });
          }}
        >
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor={`${id}-title`}>{t("newTitle")}</FieldLabel>
            <Input id={`${id}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor={`${id}-due`}>{t("due")}</FieldLabel>
            <Input id={`${id}-due`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor={`${id}-owner`}>{t("owner")}</FieldLabel>
            <NativeSelect id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <NativeSelectOption value="">{t("noOwner")}</NativeSelectOption>
              {owners.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>
                  {o.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" variant="outline" disabled={add.isPending || !title.trim() || !dueDate}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        </form>
      )}
    </div>
  );
}
