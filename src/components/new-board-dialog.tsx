"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog adding a board with the default columns. On success it opens
 * the board, or with `openIn="settings"` selects it in the board settings.
 * `trigger` replaces the default outline button.
 */
export function NewBoardDialog({
  projectSlug,
  openIn = "board",
  trigger,
}: {
  projectSlug: string;
  openIn?: "board" | "settings";
  trigger?: React.ReactNode;
}) {
  const t = useTranslations("board.newBoard");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const trpc = useTRPC();
  // The follow-up sits on the mutation, not on `mutate`: the first board replaces an empty state
  // that holds this dialog, which unmounts before the mutation settles.
  const create = useMutation(
    trpc.boards.create.mutationOptions({
      onSuccess: ({ slug: created }, { board }) => {
        setOpen(false);
        setName("");
        setSlug("");
        setSlugTouched(false);
        toast.success(t("created", { name: board.name.trim() }));
        router.push(openIn === "settings" ? `/p/${projectSlug}/settings/boards?board=${created}` : `/p/${projectSlug}/boards/${created}`);
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="outline">{t("title")}</Button>}</DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ project: projectSlug, board: { name, slug } });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="board-name">{t("name")}</FieldLabel>
              <Input
                id="board-name"
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="board-slug">{t("slug")}</FieldLabel>
              <Input
                id="board-slug"
                className="font-mono text-[13px]"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <FieldDescription>{t("slugHint")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || !slug.trim()}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
