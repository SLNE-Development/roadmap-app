"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Laptop } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useShortDate } from "@/components/account/short-date";
import { useNow } from "@/components/clock";
import { Page, PageHeader, Panel } from "@/components/page";
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

/** The sessions page body: where the user is signed in, with sign-out per device and for all other devices. */
export function SessionsView() {
  const t = useTranslations("account.sessions");
  const tc = useTranslations("common");
  const deviceName = (s: { browser: string | null; system: string | null }) =>
    s.browser === null ? t("deviceUnknown") : s.system === null ? s.browser : t("deviceOnSystem", { browser: s.browser, system: s.system });
  const format = useFormatter();
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.account.sessions.queryOptions());
  const now = useNow();
  const shortDate = useShortDate(now);
  const end = useMutation(trpc.account.endSession.mutationOptions({ onSuccess: () => toast.success(t("signedOut")) }));
  const endOthers = useMutation(
    trpc.account.endOtherSessions.mutationOptions({ onSuccess: ({ ended }) => toast.success(t("signedOutDevices", { count: ended })) }),
  );
  const pending = end.isPending || endOthers.isPending;
  const others = data.filter((s) => !s.current).length;
  return (
    <Page width="medium">
      <PageHeader crumbs={[{ label: t("crumb") }]} title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-5" aria-busy={pending}>
        <Panel
          title={t("panelTitle")}
          meta={t("sessionCount", { count: data.length })}
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending || others === 0}>
                  {t("signOutOthers")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("signOutOthersTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("signOutOthersDescription", { count: others })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => endOthers.mutate()}>{t("signOutOthers")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">{t("device")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("ip")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("signedIn")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("lastActive")}</TableHead>
                <TableHead className="pr-4 sm:pr-5">
                  <span className="sr-only">{t("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="py-2.5 pl-4 font-semibold sm:pl-5">
                    <span className="inline-flex items-center gap-2">
                      <Laptop className="size-4 text-fg-2" aria-hidden />
                      {deviceName(s)}
                      {s.current && <span className="bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-fg-2">{t("thisDevice")}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-2">{s.ip ?? ""}</TableCell>
                  <TableCell className="text-fg-2">{shortDate(s.createdAt)}</TableCell>
                  <TableCell className="text-fg-2">{format.relativeTime(s.lastActiveAt, now)}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap sm:pr-5">
                    {s.current ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={pending}
                        aria-label={t("signOutDevice", { device: deviceName(s) })}
                        onClick={() => end.mutate({ id: s.id })}
                      >
                        {t("signOut")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </Page>
  );
}
