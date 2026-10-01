"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { PencilIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("glossary");
  const tc = useTranslations("common");
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
              toast.success(t("saved", { term: term.trim() }));
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
          <FieldLabel htmlFor={`${id}-term`}>{t("term")}</FieldLabel>
          <Input id={`${id}-term`} maxLength={60} value={term} disabled={initial !== null} onChange={(e) => setTerm(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-aliases`}>{t("aliases")}</FieldLabel>
          <Input id={`${id}-aliases`} placeholder={t("aliasesPlaceholder")} value={aliases} onChange={(e) => setAliases(e.target.value)} />
          <FieldDescription>{t("aliasesHelp")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-definition`}>{t("definition")}</FieldLabel>
          <Textarea id={`${id}-definition`} rows={3} maxLength={1000} value={definition} onChange={(e) => setDefinition(e.target.value)} />
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" disabled={set.isPending || !term.trim() || !definition.trim()}>
          {initial ? t("saveTerm") : t("addTerm")}
        </Button>
        {initial && (
          <Button type="button" variant="outline" onClick={onDone}>
            {tc("cancel")}
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
  const t = useTranslations("glossary");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const [{ data: detail }, { data: terms }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.glossary.list.queryOptions({ project: slug })],
  });
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  // The toast lives on the hook: the deleted row is gone once the refetch settles.
  const remove = useMutation(
    trpc.glossary.delete.mutationOptions({
      onSuccess: (_data, { term }) => toast.success(t("deleted", { term })),
    }),
  );
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex items-baseline gap-2 px-4 py-3.5">
        <h2 className="flex-1 font-display text-[19px] font-semibold">{t("title")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{t("hint")}</span>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">{t("term")}</TableHead>
            <TableHead>{t("aliases")}</TableHead>
            <TableHead>{t("definition")}</TableHead>
            {canEdit && (
              <TableHead className="w-0">
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {terms.map((g) =>
            editing === g.id ? (
              <TableRow key={g.id}>
                <TableCell colSpan={4} className="p-0">
                  <TermForm slug={slug} initial={g} onDone={() => setEditing(null)} />
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={g.id}>
                <TableCell className="px-4 align-top font-semibold">{g.term}</TableCell>
                <TableCell className="align-top whitespace-normal text-muted-foreground">{g.aliases.join(", ")}</TableCell>
                <TableCell className="align-top whitespace-normal">{g.definition}</TableCell>
                {canEdit && (
                  <TableCell className="align-top">
                    <span className="-my-1 flex items-center">
                      <Button variant="ghost" size="icon-sm" aria-label={t("edit", { term: g.term })} onClick={() => setEditing(g.id)} className="text-muted-foreground">
                        <PencilIcon />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={t("delete", { term: g.term })} disabled={remove.isPending} className="text-muted-foreground">
                            <XIcon />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("deleteTitle", { term: g.term })}</AlertDialogTitle>
                            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => remove.mutate({ project: slug, term: g.term })}>
                              {tc("delete")}
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
                {canEdit ? t("emptyEditor") : t("empty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {canEdit && <TermForm slug={slug} initial={null} onDone={() => {}} />}
    </section>
  );
}
