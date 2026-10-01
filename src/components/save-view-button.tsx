"use client";

import { useMutation } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog saving the current page and its filter query as a view in
 * the sidebar. The name starts as `suggestedName`.
 *
 * @param props.path the page path, such as `/p/demo/systems`
 * @param props.query the URL query without `?`
 * @param props.suggestedName the name the dialog starts with
 */
export function SaveViewButton({ path, query, suggestedName }: { path: string; query: string; suggestedName: string }) {
  const t = useTranslations("board.saveView");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const trpc = useTRPC();
  const create = useMutation(
    trpc.views.create.mutationOptions({
      onSuccess: (row) => {
        setOpen(false);
        toast.success(t("saved", { name: row.name }));
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Each opening starts from the suggestion for the filters as they are now.
        if (next) setName(suggestedName);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BookmarkPlus />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, path, query });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("button")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="view-name">{t("name")}</FieldLabel>
              <Input id="view-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {t("button")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
