"use client";

import { useMutation } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
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
  const t = useTranslations("insight.releases.ship");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const ship = useMutation(trpc.releases.ship.mutationOptions({ onSuccess: () => toast.success(t("shipped", { name: releaseName })) }));
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={ship.isPending}>
          <Rocket aria-hidden />
          {t("button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name: releaseName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {unfinished.length > 0 ? t("descriptionUnfinished", { count: unfinished.length }) : t("description")}
          </AlertDialogDescription>
          {unfinished.length > 0 && (
            <ul aria-label={t("listLabel")} className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-5 text-[13.5px]">
              {unfinished.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => ship.mutate({ project: projectSlug, release: releaseSlug, unfinished: "unassign" })}>
            {unfinished.length > 0 ? t("confirmUnfinished") : t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
