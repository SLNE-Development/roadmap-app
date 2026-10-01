"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notification-kinds";
import type { NotifyRules } from "@/lib/notify-rules-schema";

/** The message key (under `notifications.rules.kinds`) of each notification kind. */
const KIND_KEYS = {
  mention: "mention",
  "question.answered": "questionAnswered",
  "question.asked": "questionAsked",
  "planning.round": "planningRound",
  "system.assigned": "systemAssigned",
  "task.assigned": "taskAssigned",
  "task.blocked": "taskBlocked",
  "system.blocked": "systemBlocked",
  "system.done": "systemDone",
  "adr.proposed": "adrProposed",
  "update.posted": "updatePosted",
  "pr.merged": "prMerged",
  "checks.failed": "checksFailed",
  "automation.blocked": "automationBlocked",
} as const satisfies Record<NotificationKind, string>;

/** One row per notification kind with an Inbox and a Push switch; Push is disabled while the server has no push keys. */
export function RulesTable({
  kinds,
  pushEnabled,
  onChange,
}: {
  kinds: NotifyRules["kinds"];
  pushEnabled: boolean;
  onChange: (kind: NotificationKind, channel: "inbox" | "push", value: boolean) => void;
}) {
  const t = useTranslations("notifications.rules");
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">{t("notifyWhen")}</TableHead>
          <TableHead className="w-20 text-xs font-semibold text-muted-foreground">{t("inbox")}</TableHead>
          <TableHead className="w-20 pr-4 text-xs font-semibold text-muted-foreground sm:pr-5">{t("push")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {NOTIFICATION_KINDS.map((kind) => {
          const label = t(`kinds.${KIND_KEYS[kind]}`);
          return (
          <TableRow key={kind}>
            <TableCell className="py-2.5 pl-4 sm:pl-5">{label}</TableCell>
            <TableCell>
              <Switch aria-label={t("inboxLabel", { label })} checked={kinds[kind].inbox} onCheckedChange={(v) => onChange(kind, "inbox", v)} />
            </TableCell>
            <TableCell className="pr-4 sm:pr-5">
              {pushEnabled ? (
                <Switch aria-label={t("pushLabel", { label })} checked={kinds[kind].push} onCheckedChange={(v) => onChange(kind, "push", v)} />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} aria-label={t("pushNotSetUp")} className="inline-flex">
                      <Switch aria-label={t("pushLabel", { label })} checked={kinds[kind].push} disabled />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{t("pushOff")}</TooltipContent>
                </Tooltip>
              )}
            </TableCell>
          </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
