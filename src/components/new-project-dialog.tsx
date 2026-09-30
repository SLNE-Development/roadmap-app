"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const trpc = useTRPC();
  // The follow-up sits on the mutation, not on `mutate`: the first project replaces an empty state
  // that holds this dialog, which unmounts before the mutation settles.
  const create = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: ({ slug: created }, { name: createdName }) => {
        setOpen(false);
        toast.success(`Project ${createdName.trim()} created`);
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
            New project
          </button>
        ) : (
          <Button>
            <Plus aria-hidden />
            New project
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
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>You become its owner. It starts with a Development board.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
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
              <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
              <Input
                id="project-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <FieldDescription>Used in URLs, surf-roadmap.json and by agents. Lowercase letters, digits and dashes.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">Description</FieldLabel>
              <Textarea id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-repo">Repository URL</FieldLabel>
              <Input id="project-repo" placeholder="https://github.com/org/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
              <FieldDescription>Commit hashes in progress updates link here.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim() || !slug.trim()}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
