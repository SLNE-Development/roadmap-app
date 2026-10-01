"use client";

import { useMutation } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PushDevice } from "@/lib/ops/push";
import { useTRPC } from "@/trpc/client";

/** The user's push devices with their last successful push, a test button and a remove button each. */
export function PushDevices({ devices, pushEnabled }: { devices: PushDevice[]; pushEnabled: boolean }) {
  const t = useTranslations("notifications.devices");
  const tc = useTranslations("common");
  const format = useFormatter();
  const trpc = useTRPC();
  const now = useNow();
  const test = useMutation(trpc.notifications.testPush.mutationOptions({ onSuccess: () => toast.success(t("testSent")) }));
  const remove = useMutation(trpc.notifications.unsubscribe.mutationOptions({ onSuccess: () => toast.success(t("removed")) }));
  if (devices.length === 0) return <p className="px-4 pb-4 text-[13.5px] text-fg-2 sm:px-5">{t("none")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">{t("device")}</TableHead>
          <TableHead className="text-xs font-semibold text-muted-foreground">{t("lastPush")}</TableHead>
          <TableHead className="pr-4 sm:pr-5">
            <span className="sr-only">{t("actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {devices.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="py-2.5 pl-4 font-semibold sm:pl-5">
              <span className="inline-flex items-center gap-2">
                <Smartphone className="size-4 text-fg-2" aria-hidden />
                {d.label}
                {d.current && <span className="bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-fg-2">{t("thisDevice")}</span>}
              </span>
            </TableCell>
            <TableCell className="text-fg-2">{d.lastSuccessAt ? t("lastPushAgo", { when: format.relativeTime(d.lastSuccessAt, now) }) : tc("none")}</TableCell>
            <TableCell className="pr-4 text-right whitespace-nowrap sm:pr-5">
              <span className="inline-flex gap-2">
                <Button variant="outline" size="sm" disabled={!pushEnabled || test.isPending} aria-label={t("sendTestTo", { label: d.label })} onClick={() => test.mutate({ id: d.id })}>
                  {t("sendTest")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={remove.isPending}
                  aria-label={t("removeLabel", { label: d.label })}
                  onClick={() => remove.mutate({ id: d.id })}
                >
                  {tc("remove")}
                </Button>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
