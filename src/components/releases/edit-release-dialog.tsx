"use client";

import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

/**
 * The Edit button and dialog of a release: name, slug and target date. Only the changed fields are
 * sent; after a slug change the page moves to the release's new URL.
 *
 * @param props.release the release as it is now
 */
export function EditReleaseDialog({
  projectSlug,
  release,
}: {
  projectSlug: string;
  release: { slug: string; name: string; targetDate: string | null };
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(release.name);
  const [slug, setSlug] = useState(release.slug);
  const [targetDate, setTargetDate] = useState(release.targetDate ?? "");
  const update = useMutation(
    trpc.releases.update.mutationOptions({
      onSuccess: ({ slug: next, name: nextName }) => {
        setOpen(false);
        toast.success(`Saved ${nextName}`);
        if (next !== release.slug) router.replace(`/p/${projectSlug}/releases/${next}`);
      },
    }),
  );
  // Start from the current values each time the dialog opens (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(release.name);
      setSlug(release.slug);
      setTargetDate(release.targetDate ?? "");
    }
  }
  const patch = {
    ...(name.trim() !== release.name ? { name } : {}),
    ...(slug.trim() !== release.slug ? { slug } : {}),
    ...((targetDate || null) !== release.targetDate ? { targetDate: targetDate || null } : {}),
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ project: projectSlug, release: release.slug, patch });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">Edit release</DialogTitle>
            <DialogDescription>Change the name, the slug or the target date.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-release-name">Name</FieldLabel>
              <Input id="edit-release-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-release-slug">Slug</FieldLabel>
              <Input id="edit-release-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <FieldDescription>Agents and links refer to the release by this. Old links stop working when it changes.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-release-target">Target date</FieldLabel>
              <Input id="edit-release-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              <FieldDescription>Optional. Without one there is no slip risk.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending || !name.trim() || !slug.trim() || Object.keys(patch).length === 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
