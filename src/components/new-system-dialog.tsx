"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createSystemAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/** Button and dialog creating a system in a board's planning column. */
export function NewSystemDialog({ projectSlug, boards }: { projectSlug: string; boards: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [board, setBoard] = useState(boards[0]?.slug ?? "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New system</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createSystemAction(projectSlug, { title, slug, summary, board });
              if (!result.ok) return void toast.error(result.error);
              setOpen(false);
              router.push(`/p/${projectSlug}/systems/${result.value.slug}`);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New system</DialogTitle>
            <DialogDescription>
              It starts in planning. Plan it with <code>/surf-roadmap:plan</code> before any work starts.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="system-title">Title</FieldLabel>
              <Input
                id="system-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="system-slug">Slug</FieldLabel>
              <Input id="system-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <FieldDescription>Agents refer to the system by this.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="system-board">Board</FieldLabel>
              <NativeSelect id="system-board" value={board} onChange={(e) => setBoard(e.target.value)}>
                {boards.map((b) => (
                  <NativeSelectOption key={b.slug} value={b.slug}>
                    {b.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="system-summary">Summary</FieldLabel>
              <Textarea id="system-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim() || !slug.trim()}>
              Create system
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
