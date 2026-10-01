"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { PencilIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { GlossaryTerm } from "@/lib/glossary-match";
import { useTRPC } from "@/trpc/client";

/** Splits comma-separated aliases, dropping blanks. */
const parseAliases = (text: string) =>
  text
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

/**
 * The add and edit form of a term. Saving a term whose name exists (ignoring case) changes it, so
 * the name of a row being edited is fixed.
 */
function TermForm({ slug, initial, onDone }: { slug: string; initial: GlossaryTerm | null; onDone: () => void }) {
  const trpc = useTRPC();
  const set = useMutation(trpc.glossary.set.mutationOptions());
  const [term, setTerm] = useState(initial?.term ?? "");
  const [definition, setDefinition] = useState(initial?.definition ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const id = initial ? `glossary-${initial.id}` : "glossary-new";
  return (
    <form
      className="flex flex-col gap-3 border-t px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        set.mutate(
          { project: slug, term, definition, aliases: parseAliases(aliases) },
          {
            onSuccess: () => {
              toast.success(`Term ${term.trim()} saved`);
              setTerm("");
              setDefinition("");
              setAliases("");
              onDone();
            },
          },
        );
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-term`}>Term</FieldLabel>
          <Input id={`${id}-term`} maxLength={60} value={term} disabled={initial !== null} onChange={(e) => setTerm(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-aliases`}>Aliases</FieldLabel>
          <Input id={`${id}-aliases`} placeholder="e.g. outbox table, event queue" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          <FieldDescription>Other spellings that count as the term; comma-separated.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-definition`}>Definition</FieldLabel>
          <Textarea id={`${id}-definition`} rows={3} maxLength={1000} value={definition} onChange={(e) => setDefinition(e.target.value)} />
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" disabled={set.isPending || !term.trim() || !definition.trim()}>
          {initial ? "Save term" : "Add term"}
        </Button>
        {initial && (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The glossary settings body: terms with aliases and definitions; editors add, edit and delete
 * (behind a confirmation).
 *
 * @param props.slug the project slug
 */
export function GlossaryView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: terms }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.glossary.list.queryOptions({ project: slug })],
  });
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  // The toast lives on the hook: the deleted row is gone once the refetch settles.
  const remove = useMutation(
    trpc.glossary.delete.mutationOptions({
      onSuccess: (_data, { term }) => toast.success(`Term ${term} deleted`),
    }),
  );
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex items-baseline gap-2 px-4 py-3.5">
        <h2 className="flex-1 font-display text-[19px] font-semibold">Glossary</h2>
        <span className="text-[12.5px] text-muted-foreground">Terms highlighted in specs and plans</span>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Term</TableHead>
            <TableHead>Aliases</TableHead>
            <TableHead>Definition</TableHead>
            {canEdit && (
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {terms.map((t) =>
            editing === t.id ? (
              <TableRow key={t.id}>
                <TableCell colSpan={4} className="p-0">
                  <TermForm slug={slug} initial={t} onDone={() => setEditing(null)} />
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={t.id}>
                <TableCell className="px-4 align-top font-semibold">{t.term}</TableCell>
                <TableCell className="align-top whitespace-normal text-muted-foreground">{t.aliases.join(", ")}</TableCell>
                <TableCell className="align-top whitespace-normal">{t.definition}</TableCell>
                {canEdit && (
                  <TableCell className="align-top">
                    <span className="-my-1 flex items-center">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.term}`} onClick={() => setEditing(t.id)} className="text-muted-foreground">
                        <PencilIcon />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.term}`} disabled={remove.isPending} className="text-muted-foreground">
                            <XIcon />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete term {t.term}?</AlertDialogTitle>
                            <AlertDialogDescription>It is no longer highlighted in documents.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => remove.mutate({ project: slug, term: t.term })}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ),
          )}
          {terms.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="px-4 py-4 text-muted-foreground">
                No terms yet.{canEdit && " Add the words your specs and plans keep using."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {canEdit && <TermForm slug={slug} initial={null} onDone={() => {}} />}
    </section>
  );
}
