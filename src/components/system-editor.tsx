"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { moveSystemAction, reopenPlanningAction, updateSystemAction } from "@/app/(app)/p/[project]/actions";
import type { ActionResult } from "@/app/actions/run";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES, type ColumnCategory, type Priority } from "@/db/schema";

/** Sidebar editor for a system's column, priority, owner and notes, plus reopening planning. */
export function SystemEditor({
  projectSlug,
  systemSlug,
  columnId,
  columns,
  planningComplete,
  priority,
  ownerUserId,
  notes,
  members,
  canEdit,
}: {
  projectSlug: string;
  systemSlug: string;
  columnId: string;
  columns: { id: string; name: string; category: ColumnCategory }[];
  planningComplete: boolean;
  priority: Priority;
  ownerUserId: string | null;
  notes: string;
  members: { userId: string; name: string }[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(notes);

  /** Runs an action and toasts its error. */
  const act = (fn: () => Promise<ActionResult<unknown>>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
    });

  return (
    <Card aria-busy={pending}>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="system-column">Column</FieldLabel>
            <NativeSelect
              id="system-column"
              value={columnId}
              disabled={!canEdit || pending}
              onChange={(e) => act(() => moveSystemAction(projectSlug, systemSlug, { column: e.target.value }))}
            >
              {columns.map((c) => (
                <NativeSelectOption key={c.id} value={c.id} disabled={!planningComplete && c.category !== "planning"}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {!planningComplete && <FieldDescription>Other columns unlock when the planning interview is complete.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="system-priority">Priority</FieldLabel>
            <NativeSelect
              id="system-priority"
              value={priority}
              disabled={!canEdit || pending}
              onChange={(e) => act(() => updateSystemAction(projectSlug, systemSlug, { priority: e.target.value as Priority }))}
            >
              {PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {p}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="system-owner">Owner</FieldLabel>
            <NativeSelect
              id="system-owner"
              value={ownerUserId ?? ""}
              disabled={!canEdit || pending}
              onChange={(e) => act(() => updateSystemAction(projectSlug, systemSlug, { ownerUserId: e.target.value || null }))}
            >
              <NativeSelectOption value="">Unowned</NativeSelectOption>
              {members.map((m) => (
                <NativeSelectOption key={m.userId} value={m.userId}>
                  {m.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="system-notes">Notes</FieldLabel>
            <Textarea id="system-notes" className="min-h-28" value={draft} disabled={!canEdit} onChange={(e) => setDraft(e.target.value)} />
            {canEdit && (
              <Button variant="outline" className="self-start" disabled={pending || draft === notes} onClick={() => act(() => updateSystemAction(projectSlug, systemSlug, { notes: draft }))}>
                Save notes
              </Button>
            )}
          </Field>
          {canEdit && planningComplete && (
            <Button variant="ghost" className="self-start" disabled={pending} onClick={() => act(() => reopenPlanningAction(projectSlug, systemSlug))}>
              Reopen planning
            </Button>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
