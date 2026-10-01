"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_TYPES, type FieldType } from "@/db/schema";
import { slugify } from "@/lib/slug";
import { useTRPC } from "@/trpc/client";

/** A custom field as the settings show it. */
export interface FieldItem {
  key: string;
  name: string;
  type: FieldType;
  options: string[];
}

/** Display names of the field types. */
const TYPE_LABEL: Record<FieldType, string> = { text: "Text", select: "Select", number: "Number", date: "Date" };

/**
 * The form of the create and edit dialogs. Creating picks key and type (the
 * key follows the name until edited); editing changes the name and, for select
 * fields, the options only. Options are one per line.
 */
function FieldForm({ projectSlug, initial, onDone }: { projectSlug: string; initial: FieldItem | null; onDone: () => void }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.fields.create.mutationOptions());
  const update = useMutation(trpc.fields.update.mutationOptions());
  const [name, setName] = useState(initial?.name ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>(initial?.type ?? "text");
  const [options, setOptions] = useState((initial?.options ?? []).join("\n"));
  const list = options
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  const pending = create.isPending || update.isPending;
  const hasOptions = type === "select";
  const submit = () => {
    if (initial) {
      update.mutate(
        { project: projectSlug, key: initial.key, patch: { name, ...(hasOptions ? { options: list } : {}) } },
        {
          onSuccess: () => {
            toast.success(`Field ${name.trim()} saved`);
            onDone();
          },
        },
      );
    } else {
      create.mutate(
        { project: projectSlug, field: { key, name, type, options: hasOptions ? list : [] } },
        {
          onSuccess: () => {
            toast.success(`Field ${name.trim()} added`);
            onDone();
          },
        },
      );
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{initial ? `Edit ${initial.name}` : "New field"}</DialogTitle>
        <DialogDescription>A value every system of the project can carry. The type cannot change later.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="field-name">Name</FieldLabel>
          <Input
            id="field-name"
            placeholder="e.g. Risk"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!initial && !keyTouched) setKey(slugify(e.target.value));
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="field-key">Key</FieldLabel>
          <Input
            id="field-key"
            className="font-mono text-[13px]"
            value={key}
            disabled={initial !== null}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
          />
          <FieldDescription>Agents set the value by this key; lowercase letters, digits and dashes.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="field-type">Type</FieldLabel>
          <NativeSelect id="field-type" value={type} disabled={initial !== null} onChange={(e) => setType(e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {hasOptions && (
          <Field>
            <FieldLabel htmlFor="field-options">Options</FieldLabel>
            <Textarea id="field-options" rows={4} placeholder={"low\nmedium\nhigh"} value={options} onChange={(e) => setOptions(e.target.value)} />
            <FieldDescription>One per line. An option that systems still use cannot be removed.</FieldDescription>
          </Field>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim() || !key.trim() || (hasOptions && list.length === 0)}>
          {initial ? "Save field" : "Create field"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The fields settings: the project's custom fields in order with their type
 * and options, and for owners create and edit dialogs, up/down reordering and
 * deletion behind a confirmation.
 */
export function FieldsManager({ projectSlug, fields, canEdit }: { projectSlug: string; fields: FieldItem[]; canEdit: boolean }) {
  const trpc = useTRPC();
  const reorder = useMutation(trpc.fields.reorder.mutationOptions());
  // The toast lives on the hook: the deleted row is gone once the refetch settles.
  const remove = useMutation(
    trpc.fields.delete.mutationOptions({
      onMutate: ({ key }) => fields.find((f) => f.key === key)?.name,
      onSuccess: (_data, _input, name) => toast.success(`Field ${name ?? ""} deleted`),
    }),
  );
  const pending = reorder.isPending || remove.isPending;
  const [dialog, setDialog] = useState<{ field: FieldItem | null } | null>(null);
  const move = (index: number, dir: -1 | 1) => {
    const keys = fields.map((f) => f.key);
    [keys[index], keys[index + dir]] = [keys[index + dir], keys[index]];
    reorder.mutate({ project: projectSlug, orderedKeys: keys });
  };
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex items-baseline gap-2 px-4 py-3.5">
        <h2 className="flex-1 font-display text-[19px] font-semibold">Fields</h2>
        <span className="text-[12.5px] text-muted-foreground">Extra properties of every system</span>
      </header>
      <ul aria-busy={pending}>
        {fields.map((f, i) => (
          <li key={f.key} className="flex items-start gap-2.5 border-t px-4 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold">{f.name}</span>
              <span className="font-mono text-[12px] text-muted-foreground">{f.key}</span>
              {f.options.length > 0 && <span className="text-[12.5px] text-muted-foreground">{f.options.join(", ")}</span>}
            </span>
            <span className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground">{TYPE_LABEL[f.type]}</span>
            {canEdit && (
              <span className="-my-1 flex shrink-0 items-center">
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${f.name} up`} disabled={pending || i === 0} onClick={() => move(i, -1)} className="text-muted-foreground">
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${f.name} down`}
                  disabled={pending || i === fields.length - 1}
                  onClick={() => move(i, 1)}
                  className="text-muted-foreground"
                >
                  <ArrowDownIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${f.name}`} disabled={pending} onClick={() => setDialog({ field: f })} className="text-muted-foreground">
                  <PencilIcon />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.name}`} disabled={pending} className="text-muted-foreground">
                      <XIcon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete field {f.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Every system loses its value for this field.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => remove.mutate({ project: projectSlug, key: f.key })}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </span>
            )}
          </li>
        ))}
        {fields.length === 0 && (
          <li className="border-t px-4 py-4 text-[13px] text-muted-foreground">No fields yet.{canEdit && " Add one such as Risk or Effort."}</li>
        )}
      </ul>
      {canEdit && (
        <button
          type="button"
          onClick={() => setDialog({ field: null })}
          className="flex items-center gap-2 border-t px-4 py-2.5 text-left text-[13px] font-semibold text-brand-strong outline-none hover:bg-muted focus-visible:bg-muted"
        >
          <PlusIcon className="size-3.5" aria-hidden />
          Add field
        </button>
      )}
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>{dialog && <FieldForm projectSlug={projectSlug} initial={dialog.field} onDone={() => setDialog(null)} />}</DialogContent>
      </Dialog>
    </section>
  );
}
