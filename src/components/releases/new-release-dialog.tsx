"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
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
        toast.success(`Created ${createdName}`);
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
          New release
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
            <DialogTitle className="font-display text-[19px] font-semibold">New release</DialogTitle>
            <DialogDescription>A release groups systems that ship together. Assign systems from their page.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="release-name">Name</FieldLabel>
              <Input
                id="release-name"
                value={name}
                autoFocus
                placeholder="1.0"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="release-slug">Slug</FieldLabel>
              <Input
                id="release-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
              />
              <FieldDescription>Agents and links refer to the release by this.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="release-target">Target date</FieldLabel>
              <Input id="release-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              <FieldDescription>Optional. Without one there is no slip risk.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !name.trim() || !slug.trim()}>
              Create release
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
