"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Markdown } from "./markdown";

/** Above this many characters, notes start clipped with a "Show all" toggle. */
const LONG_NOTES = 400;

/**
 * The Notes panel of the system's right rail: the notes rendered, clipped when
 * long, and for editors an "Edit notes" button that opens the editor.
 * Hidden for viewers when there are no notes.
 */
export function SystemNotes({ projectSlug, systemSlug, notes, canEdit }: { projectSlug: string; systemSlug: string; notes: string; canEdit: boolean }) {
  const trpc = useTRPC();
  // Saved notes remount this panel (keyed by the notes), so the toast lives on the mutation.
  const update = useMutation(trpc.systems.update.mutationOptions({ onSuccess: () => toast.success("Notes saved") }));
  const pending = update.isPending;
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(notes);
  const long = notes.length > LONG_NOTES;

  if (!canEdit && !notes.trim()) return null;
  return (
    <section className="flex flex-col gap-2.5 border bg-card p-4" aria-busy={pending}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Notes</h2>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setDraft(notes);
              setEditing(true);
            }}
          >
            {notes.trim() ? "Edit notes" : "Add notes"}
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { project: projectSlug, system: systemSlug, patch: { notes: draft } },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          <Textarea aria-label="Notes" className="min-h-40 text-[13px]" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <p className="text-xs text-muted-foreground">Markdown works here.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || draft === notes}>
              Save notes
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : notes.trim() ? (
        <>
          <div className={cn("relative", long && !expanded && "max-h-40 overflow-hidden")}>
            <Markdown className="text-[13px] leading-normal text-fg-2">{notes}</Markdown>
            {long && !expanded && <div aria-hidden className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent" />}
          </div>
          {long && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="self-start text-[12.5px] font-medium text-brand-strong hover:underline">
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </>
      ) : (
        <p className="text-[12.5px] text-fg-2">Keep context for people and agents here: links, constraints, decisions in progress.</p>
      )}
    </section>
  );
}
