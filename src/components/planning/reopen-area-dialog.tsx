"use client";

import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AREA_LABEL } from "@/components/system/text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PLANNING_AREAS, type PlanningArea } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog reopening one planning area of a system with complete planning.
 *
 * @param props.reopened the areas that are already reopened, left out of the choice
 */
export function ReopenAreaDialog({ projectSlug, systemSlug, reopened }: { projectSlug: string; systemSlug: string; reopened: PlanningArea[] }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState<PlanningArea | "">("");
  const [reason, setReason] = useState("");
  const choices = PLANNING_AREAS.filter((a) => !reopened.includes(a));
  const chosen = area && choices.includes(area) ? area : (choices[0] ?? "");
  const reopen = useMutation(
    trpc.planning.reopenArea.mutationOptions({
      onSuccess: (_, input) => {
        setOpen(false);
        setReason("");
        toast.success(`Area ${input.area} reopened`);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={choices.length === 0}>
          <RotateCcw aria-hidden />
          Reopen one area
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) reopen.mutate({ project: projectSlug, system: systemSlug, area: chosen, reason });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">Reopen one planning area</DialogTitle>
            <DialogDescription>
              The system stays where it is and planning stays complete. Only this area accepts new questions, and the system cannot move to a done column until
              it is completed again.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reopen-area">Area</FieldLabel>
              <NativeSelect id="reopen-area" value={chosen} onChange={(e) => setArea(e.target.value as PlanningArea)}>
                {choices.map((a) => (
                  <NativeSelectOption key={a} value={a}>
                    {AREA_LABEL[a]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="reopen-reason">Reason</FieldLabel>
              <Textarea id="reopen-reason" value={reason} required minLength={3} placeholder="What changed since planning was completed?" onChange={(e) => setReason(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={reopen.isPending || !chosen || reason.trim().length < 3}>
              Reopen area
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
