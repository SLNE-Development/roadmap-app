"use client";

import { useMutation } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
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
import { plural } from "@/lib/text";
import { useTRPC } from "@/trpc/client";

/**
 * The owner's Ship button with its confirmation. When systems are not done it lists them and offers
 * to move them out of the release and ship; otherwise it just confirms.
 *
 * @param props.unfinished the titles of the release's systems that are not done
 */
export function ShipReleaseDialog({
  projectSlug,
  releaseSlug,
  releaseName,
  unfinished,
}: {
  projectSlug: string;
  releaseSlug: string;
  releaseName: string;
  unfinished: string[];
}) {
  const trpc = useTRPC();
  const ship = useMutation(trpc.releases.ship.mutationOptions({ onSuccess: () => toast.success(`Shipped ${releaseName}`) }));
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={ship.isPending}>
          <Rocket aria-hidden />
          Ship
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ship {releaseName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {unfinished.length > 0
              ? `${plural(unfinished.length, "system isn't", "systems aren't")} done and would leave the release. Shipping then freezes its scope and writes the release notes.`
              : "Shipping fixes the release's scope and writes its release notes."}
          </AlertDialogDescription>
          {unfinished.length > 0 && (
            <ul aria-label="Unfinished systems" className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-5 text-[13.5px]">
              {unfinished.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => ship.mutate({ project: projectSlug, release: releaseSlug, unfinished: "unassign" })}>
            {unfinished.length > 0 ? "Move them out and ship" : "Ship release"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
