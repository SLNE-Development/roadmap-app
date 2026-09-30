"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { useTRPC } from "@/trpc/client";

/** Accepts a proposed ADR after a confirmation, since accepting freezes it. */
export function AcceptAdrButton({ projectSlug, number, label }: { projectSlug: string; number: number; label: string }) {
  const trpc = useTRPC();
  // The toast sits on the hook, not on `mutate`: this button unmounts once the refetch shows the ADR accepted.
  const accept = useMutation(trpc.adrs.accept.mutationOptions({ onSuccess: () => toast.success(`${label} accepted`) }));
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={accept.isPending}>
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
          <AlertDialogAction onClick={() => accept.mutate({ project: projectSlug, number })}>
            Accept decision
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
