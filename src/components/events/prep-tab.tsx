"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { fromZonedInput, toZonedInput } from "@/lib/zoned-time";
import { useTRPC } from "@/trpc/client";

/** The to-do keys of the prep template, which have a translated title. */
const TEMPLATE_KEYS = ["team-message", "announcement", "build-ready", "rehearsal", "reminder", "recap"] as const;

/**
 * The Prep tab: the to-dos with owner, due date, a done checkbox and a red "Late" badge, and a form for more.
 *
 * @param props.requestId the request
 * @param props.canEdit whether the actor may add, change and remove to-dos
 */
export function PrepTab({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const t = useTranslations("events.prep");
  const trpc = useTRPC();
  const zone = useTimeZone() ?? "UTC";
  const format = useFormatter();
  const id = useId();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [owner, setOwner] = useState("");
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
  const titleOf = (todo: (typeof todos)[number]) => ((TEMPLATE_KEYS as readonly string[]).includes(todo.templateKey ?? "") ? t(`template.${todo.templateKey as (typeof TEMPLATE_KEYS)[number]}`) : todo.title);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {todos.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y border bg-card">
          {todos.map((todo) => (
            <li key={`${todo.id}-${todo.dueAt.getTime()}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-[13.5px]">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={todo.doneAt !== null}
                  disabled={done.isPending}
                  onChange={(e) => done.mutate({ todoId: todo.id, done: e.target.checked })}
                />
                <span className={todo.doneAt ? "text-muted-foreground line-through" : undefined}>{titleOf(todo)}</span>
                {todo.late && <Badge variant="destructive">{t("late")}</Badge>}
              </label>
              <NativeSelect
                size="sm"
                aria-label={t("owner")}
                value={todo.ownerUserId ?? ""}
                disabled={!canEdit}
                onChange={(e) => update.mutate({ todoId: todo.id, ownerUserId: e.target.value || null })}
              >
                <NativeSelectOption value="">{t("noOwner")}</NativeSelectOption>
                {owners.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {canEdit ? (
                <Input
                  type="datetime-local"
                  aria-label={t("due")}
                  className="w-auto"
                  defaultValue={toZonedInput(todo.dueAt, zone)}
                  onBlur={(e) => {
                    const next = fromZonedInput(e.target.value, zone);
                    if (next && next.getTime() !== todo.dueAt.getTime()) update.mutate({ todoId: todo.id, dueAt: next });
                  }}
                />
              ) : (
                <time dateTime={todo.dueAt.toISOString()}>{format.dateTime(todo.dueAt, { dateStyle: "medium", timeStyle: "short" })}</time>
              )}
              {canEdit && todo.templateKey === null && (
                <Button type="button" size="sm" variant="ghost" onClick={() => remove.mutate({ todoId: todo.id })}>
                  {t("remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-3"
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
          <Button type="submit" disabled={add.isPending || !title.trim() || !dueDate}>
            {t("add")}
          </Button>
        </form>
      )}
    </div>
  );
}
