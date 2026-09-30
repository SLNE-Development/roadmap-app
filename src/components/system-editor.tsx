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
  // The toast lives on the mutation so it survives the panel closing the editor.
  const update = useMutation(trpc.systems.update.mutationOptions({ onSuccess: () => toast.success("Notes saved") }));
  const pending = update.isPending;
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Until the user types, the textarea follows the incoming notes; once dirty it keeps their draft.
  const [draft, setDraft] = useState(notes);
  const [dirty, setDirty] = useState(false);
  // The notes as they were when editing started, to notice changes made elsewhere meanwhile.
  const [startNotes, setStartNotes] = useState(notes);
  // While the user has not typed, the baseline follows the incoming notes.
  if (!dirty && startNotes !== notes) setStartNotes(notes);
  const text = dirty ? draft : notes;
  const changedElsewhere = dirty && notes !== startNotes;
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
              setDirty(false);
              setStartNotes(notes);
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
              { project: projectSlug, system: systemSlug, patch: { notes: text } },
              {
                onSuccess: () => {
                  setDirty(false);
                  setEditing(false);
                },
              },
            );
          }}
        >
          <Textarea
            aria-label="Notes"
            className="min-h-40 text-[13px]"
            value={text}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
          />
          <p className="text-xs text-muted-foreground">Markdown works here.</p>
          {changedElsewhere && <p className="text-xs text-cat-planning">Notes changed elsewhere since you started editing.</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || text === notes}>
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
