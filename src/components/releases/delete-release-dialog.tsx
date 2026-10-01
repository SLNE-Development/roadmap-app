"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
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

/** The owner's Delete button with its confirmation, then back to the release list. Only a planned release can be deleted. */
export function DeleteReleaseDialog({ projectSlug, releaseSlug, releaseName }: { projectSlug: string; releaseSlug: string; releaseName: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const remove = useMutation(
    trpc.releases.delete.mutationOptions({
      onSuccess: () => {
        toast.success(`Deleted ${releaseName}`);
        router.push(`/p/${projectSlug}/releases`);
      },
    }),
  );
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={remove.isPending}>
          <Trash2 aria-hidden />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {releaseName}?</AlertDialogTitle>
          <AlertDialogDescription>Its systems stay as they are but leave the release. Its release notes are deleted with it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate({ project: projectSlug, release: releaseSlug })}>Delete release</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
