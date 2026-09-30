"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createBoardAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";

/** Button and dialog adding a board with the default columns; opens it on success. */
export function NewBoardDialog({ projectSlug }: { projectSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">New board</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createBoardAction(projectSlug, { name, slug });
              if (!result.ok) return void toast.error(result.error);
              setOpen(false);
              router.push(`/p/${projectSlug}/boards/${result.value.slug}`);
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
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="board-slug">Slug</FieldLabel>
              <Input id="board-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
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
