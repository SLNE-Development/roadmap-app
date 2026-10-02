"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { RepoField } from "@/components/github/repo-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC, useTRPCClient } from "@/trpc/client";

/** A repository address as the placeholder shows it; the same in every language. */
const REPO_PLACEHOLDER = "https://github.com/org/repo";

/** Turns a name into a slug suggestion: lowercase words joined by dashes. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Button and dialog creating a project; opens the new project on success.
 *
 * @param props.variant `button` for the primary header button, `tile` for the dashed last cell of the project grid
 */
export function NewProjectDialog({ variant = "button" }: { variant?: "button" | "tile" }) {
  const t = useTranslations("home.newProject");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  // The follow-up sits on the mutation, not on `mutate`: the first project replaces an empty state
  // that holds this dialog, which unmounts before the mutation settles.
  const [pickedRepo, setPickedRepo] = useState<string | null>(null);
  const create = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: async ({ slug: created }, { name: createdName }) => {
        setOpen(false);
        toast.success(t("created", { name: createdName.trim() }));
        if (pickedRepo) {
          // The vanilla client, so the link does not depend on this dialog staying mounted.
          try {
            await trpcClient.github.linkAppRepo.mutate({ project: created, repo: { fullName: pickedRepo } });
          } catch {
            toast.error(t("repoLinkFailed", { name: pickedRepo }));
          }
        }
        router.push(`/p/${created}`);
      },
    }),
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "tile" ? (
          <button
            type="button"
            className="flex min-h-[150px] flex-1 flex-col items-center justify-center gap-2 border border-dashed text-[13.5px] font-medium text-fg-2 outline-none transition-colors hover:border-primary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus aria-hidden className="size-[18px]" />
            {t("button")}
          </button>
        ) : (
          <Button>
            <Plus aria-hidden />
            {t("button")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, slug, description, repoUrl: repoUrl.trim() || null });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">{t("name")}</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-slug">{t("slug")}</FieldLabel>
              <Input
                id="project-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <FieldDescription>{t("slugHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">{t("descriptionLabel")}</FieldLabel>
              <Textarea id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-repo">{t("repoUrl")}</FieldLabel>
              <RepoField
                id="project-repo"
                placeholder={REPO_PLACEHOLDER}
                value={repoUrl}
                onChange={(value, picked) => {
                  setRepoUrl(value);
                  setPickedRepo(picked);
                }}
              />
              <FieldDescription>{t("repoHint")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim() || !slug.trim()}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
