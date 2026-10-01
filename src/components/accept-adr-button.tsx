"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("adrs.accept");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  // The toast sits on the hook, not on `mutate`: this button unmounts once the refetch shows the ADR accepted.
  const accept = useMutation(trpc.adrs.accept.mutationOptions({ onSuccess: () => toast.success(t("accepted", { label })) }));
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={accept.isPending}>
          {t("button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { label })}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => accept.mutate({ project: projectSlug, number })}>{t("button")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
