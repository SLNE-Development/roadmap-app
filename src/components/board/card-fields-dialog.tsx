"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { BUILTIN_CARD_FIELDS, MAX_CARD_FIELDS, type CardField } from "@/lib/card-fields";
import { useTRPC } from "@/trpc/client";

/** A custom field of the project, offered as a card field by its key. */
export interface CardFieldCustom {
  key: string;
  name: string;
}

/**
 * Dialog choosing which fields the cards of a board show and in which order.
 *
 * @param props.fields the fields shown now, in order
 */
export function CardFieldsDialog({
  projectSlug,
  boardSlug,
  fields,
  customFields,
  open,
  onOpenChange,
}: {
  projectSlug: string;
  boardSlug: string;
  fields: CardField[];
  customFields: CardFieldCustom[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CardFieldsForm
          projectSlug={projectSlug}
          boardSlug={boardSlug}
          fields={fields}
          customFields={customFields}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The form of {@link CardFieldsDialog}; mounted only while the dialog is open, so it starts from the saved fields each time. */
function CardFieldsForm({
  projectSlug,
  boardSlug,
  fields,
  customFields,
  onDone,
}: {
  projectSlug: string;
  boardSlug: string;
  fields: CardField[];
  customFields: CardFieldCustom[];
  onDone: () => void;
}) {
  const t = useTranslations("board.cardFields");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const save = useMutation(trpc.boards.setCardFields.mutationOptions({ onSuccess: () => (toast.success(t("saved")), onDone()) }));
  const labels = new Map<string, string>([
    ...BUILTIN_CARD_FIELDS.map((f): [string, string] => [f, t(f)]),
    ...customFields.map((f): [string, string] => [`custom:${f.key}`, f.name]),
  ]);
  // Every option in display order: the chosen ones first, then the rest.
  const [order, setOrder] = useState<string[]>(() => [...fields, ...[...labels.keys()].filter((k) => !fields.includes(k as CardField))]);
  const [on, setOn] = useState<Set<string>>(() => new Set(fields));

  const shift = (i: number, by: number) =>
    setOrder((prev) => {
      const next = [...prev];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const toggle = (key: string, checked: boolean) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { max: MAX_CARD_FIELDS })}</DialogDescription>
      </DialogHeader>
      <ul className="flex max-h-[50vh] flex-col overflow-y-auto border">
        {order.map((key, i) => {
          const label = labels.get(key) ?? key;
          return (
            <li key={key} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
              <Switch
                aria-label={label}
                checked={on.has(key)}
                disabled={!on.has(key) && on.size >= MAX_CARD_FIELDS}
                onCheckedChange={(checked) => toggle(key, checked)}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              <Button variant="ghost" size="icon-xs" aria-label={t("moveUp", { label })} disabled={i === 0} onClick={() => shift(i, -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t("moveDown", { label })} disabled={i === order.length - 1} onClick={() => shift(i, 1)}>
                <ArrowDown />
              </Button>
            </li>
          );
        })}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => save.mutate({ project: projectSlug, board: boardSlug, fields: order.filter((k) => on.has(k)) })}
        >
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
