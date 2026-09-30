"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createBoardAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="outline">New board</Button>}</DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createBoardAction(projectSlug, { name, slug });
              if (!result.ok) return void toast.error(result.error);
              setOpen(false);
              setName("");
              setSlug("");
              toast.success(`Board ${name.trim()} created`);
              router.push(
                openIn === "settings"
                  ? `/p/${projectSlug}/settings/boards?board=${result.value.slug}`
                  : `/p/${projectSlug}/boards/${result.value.slug}`,
              );
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>A workstream such as Building. It starts with the default columns, which you can change.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="board-name">Name</FieldLabel>
              <Input
                id="board-name"
                placeholder="e.g. Operations"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="board-slug">Slug</FieldLabel>
              <Input id="board-slug" className="font-mono text-[13px]" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <FieldDescription>Used in the board&apos;s address; lowercase letters, digits and dashes.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim() || !slug.trim()}>
              Create board
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
