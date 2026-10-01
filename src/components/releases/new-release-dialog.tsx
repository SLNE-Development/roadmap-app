"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog creating a planned release, then opening it. The slug follows the
 * name until it is edited by hand; the target date is optional.
 */
export function NewReleaseDialog({ projectSlug }: { projectSlug: string }) {
  const t = useTranslations("insight.releases");
  const tc = useTranslations("common");
  const router = useRouter();
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [targetDate, setTargetDate] = useState("");
  // The follow-up lives in the options, not in `mutate`: the empty state holding this dialog unmounts once the first release arrives.
  const create = useMutation(
    trpc.releases.create.mutationOptions({
      onSuccess: ({ slug: created, name: createdName }) => {
        setOpen(false);
        toast.success(t("new.created", { name: createdName }));
        router.push(`/p/${projectSlug}/releases/${created}`);
      },
    }),
  );
  // Start empty each time the dialog opens (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setSlug("");
      setSlugEdited(false);
      setTargetDate("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("new.button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ project: projectSlug, release: { name, slug, targetDate: targetDate || null } });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("new.title")}</DialogTitle>
            <DialogDescription>{t("new.description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="release-name">{t("form.name")}</FieldLabel>
              <Input
                id="release-name"
                value={name}
                autoFocus
                placeholder={t("new.namePlaceholder")}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="release-slug">{t("form.slug")}</FieldLabel>
              <Input
                id="release-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
              />
              <FieldDescription>{t("new.slugHelp")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="release-target">{t("form.target")}</FieldLabel>
              <Input id="release-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              <FieldDescription>{t("form.targetHelp")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !name.trim() || !slug.trim()}>
              {t("new.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
