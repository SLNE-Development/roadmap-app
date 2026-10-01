"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

/** Minutes from `start` to `end` (datetime-local values in the viewer's time zone), or null when either is empty. */
function minutesBetween(start: string, end: string): number | null {
  if (!start || !end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

/** The "New request" button and dialog: a title and an optional start and end; creates the draft without a brief and opens it. */
export function NewRequestDialog() {
  const t = useTranslations("events.list");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const minutes = minutesBetween(start, end);
  const badEnd = minutes !== null && (minutes < 5 || minutes > 10080);
  const create = useMutation(
    trpc.requests.create.mutationOptions({
      onSuccess: ({ id }) => {
        setOpen(false);
        setTitle("");
        setStart("");
        setEnd("");
        router.push(`/requests/${id}`);
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("newRequest")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ title, brief: "", ...(start ? { startsAt: new Date(start).toISOString() } : {}), ...(start && minutes !== null ? { durationMinutes: minutes } : {}) });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-request-title">{t("titleLabel")}</FieldLabel>
              <Input id="new-request-title" value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="new-request-start">{t("startsLabel")}</FieldLabel>
                <Input id="new-request-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-request-end">{t("endsLabel")}</FieldLabel>
                <Input id="new-request-end" type="datetime-local" value={end} min={start || undefined} disabled={!start} aria-invalid={badEnd} onChange={(e) => setEnd(e.target.value)} />
                {badEnd && <FieldDescription className="text-destructive">{t("endBeforeStart")}</FieldDescription>}
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !title.trim() || badEnd}>
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
