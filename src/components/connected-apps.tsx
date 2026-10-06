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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTRPC } from "@/trpc/client";
import { Panel } from "./page";

/** A connected app as the page shows it, with its dates already formatted. */
export interface ConnectedAppItem {
  clientId: string;
  name: string;
  granted: string;
  lastUsed: string;
}

/**
 * The apps (MCP clients) the user signed in with OAuth, each with a Revoke that cuts its
 * access at once. Renders nothing while there are none.
 */
export function ConnectedApps({ apps }: { apps: ConnectedAppItem[] }) {
  const t = useTranslations("account.connectedApps");
  const trpc = useTRPC();
  const revoke = useMutation(trpc.account.revokeConnectedApp.mutationOptions({ onSuccess: () => toast.success(t("revoked")) }));
  if (apps.length === 0) return null;
  return (
    <Panel title={t("title")} meta={t("description")}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">{t("app")}</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">{t("granted")}</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">{t("lastUsed")}</TableHead>
            <TableHead className="pr-4 sm:pr-5">
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((app) => (
            <TableRow key={app.clientId}>
              <TableCell className="py-2.5 pl-4 font-semibold break-all sm:pl-5">{app.name}</TableCell>
              <TableCell className="text-fg-2">{app.granted}</TableCell>
              <TableCell className="text-fg-2">{app.lastUsed}</TableCell>
              <TableCell className="pr-4 text-right sm:pr-5">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={revoke.isPending}>
                      {t("revoke")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("revokeTitle", { name: app.name })}</AlertDialogTitle>
                      <AlertDialogDescription>{t("revokeDescription")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => revoke.mutate({ clientId: app.clientId })}>
                        {t("revoke")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
