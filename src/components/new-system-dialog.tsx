"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { slugify } from "@/lib/slug";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog creating a system in a board's planning column, then
 * opening it.
 *
 * @param props.defaultBoard the board preselected each time it opens (default: the first one)
 * @param props.trigger a custom trigger element replacing the "New system" button; `null` renders none
 * @param props.open controls whether the dialog is open, together with `onOpenChange`
 */
export function NewSystemDialog({
  projectSlug,
  boards,
  defaultBoard,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  projectSlug: string;
  boards: { slug: string; name: string }[];
  defaultBoard?: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  // The follow-up lives in the options, not in `mutate`: the empty state holding this dialog unmounts
  // once the first system arrives, and per-call callbacks are dropped on unmount.
  const create = useMutation(
    trpc.systems.create.mutationOptions({
      onSuccess: ({ slug }, { system }) => {
        setOpen(false);
        toast.success(`Created ${system.title.trim()}`);
        router.push(`/p/${projectSlug}/systems/${slug}`);
      },
    }),
  );
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [summary, setSummary] = useState("");
  const debouncedTitle = useDebouncedValue(title.trim(), 300);
  const similar = useQuery({
    ...trpc.systems.similar.queryOptions({ project: projectSlug, title: debouncedTitle }),
    enabled: open && debouncedTitle.length >= 3,
  });
  // Hidden while the title is too short, and while it is ahead of the debounced query.
  const similarSystems = title.trim() === debouncedTitle && debouncedTitle.length >= 3 ? (similar.data ?? []) : [];
  const initialBoard = defaultBoard ?? boards[0]?.slug ?? "";
  const [board, setBoard] = useState(initialBoard);
  // The "c" shortcut asks the dialog on the page to open.
  useEffect(() => {
    const onNew = () => setOpen(true);
    window.addEventListener("roadmap:new-system", onNew);
    return () => window.removeEventListener("roadmap:new-system", onNew);
  });
  // Preselect the default board each time the dialog opens (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setBoard(initialBoard);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus aria-hidden />
              New system
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ project: projectSlug, system: { title, slug, summary, board } });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">New system</DialogTitle>
            <DialogDescription>
              It starts in planning. Plan it with <code className="font-mono text-[12.5px]">/surf-roadmap:plan</code> before any work starts.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="system-title">Title</FieldLabel>
              <Input
                id="system-title"
                value={title}
                autoFocus
                placeholder="Vehicle garages"
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
              />
              {similarSystems.length > 0 && (
                <FieldDescription>
                  Similar:{" "}
                  {similarSystems.map((s, i) => (
                    <span key={s.slug}>
                      {i > 0 && ", "}
                      <a href={`/p/${projectSlug}/systems/${s.slug}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {s.title}
                      </a>
                      {s.archived && " (archived)"}
                    </span>
                  ))}
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="system-slug">Slug</FieldLabel>
              <Input
                id="system-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
              />
              <FieldDescription>Agents refer to the system by this.</FieldDescription>
            </Field>
            {boards.length > 1 && (
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
            )}
            <Field>
              <FieldLabel htmlFor="system-summary">Summary</FieldLabel>
              <Textarea
                id="system-summary"
                value={summary}
                placeholder="What the system does, in a sentence or two."
                onChange={(e) => setSummary(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !title.trim() || !slug.trim()}>
              Create system
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
