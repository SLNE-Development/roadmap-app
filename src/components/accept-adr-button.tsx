"use client";

import { toast } from "sonner";
import { acceptAdrAction } from "@/app/(app)/p/[project]/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "./use-action";

/** Accepts a proposed ADR after a confirmation, since accepting freezes it. */
export function AcceptAdrButton({ projectSlug, number, label }: { projectSlug: string; number: number; label: string }) {
  const { pending, act } = useAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={pending}>
          Accept decision
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Accept {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Accepted decisions can no longer be edited. To change it later, a new decision has to supersede it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => act(() => acceptAdrAction(projectSlug, number), () => toast.success(`${label} accepted`))}>
            Accept decision
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
