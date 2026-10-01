"use client";

import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notification-kinds";
import type { NotifyRules } from "@/lib/notify-rules-schema";

/** The human label of each notification kind. */
const KIND_LABELS: Record<NotificationKind, string> = {
  mention: "Someone mentions me",
  "question.answered": "My question is answered",
  "question.asked": "A question is asked on my system",
  "planning.round": "Planning questions on my system",
  "system.assigned": "I become owner of a system",
  "task.assigned": "I become owner of a task",
  "task.blocked": "A task on my system is blocked",
  "system.blocked": "My system is blocked",
  "system.done": "My system is done",
  "adr.proposed": "A decision is proposed on my system",
  "update.posted": "A progress update on my system",
};

const PUSH_OFF = "Push notifications are not set up on this server. An admin sets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.";

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
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">Notify me when</TableHead>
          <TableHead className="w-20 text-xs font-semibold text-muted-foreground">Inbox</TableHead>
          <TableHead className="w-20 pr-4 text-xs font-semibold text-muted-foreground sm:pr-5">Push</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {NOTIFICATION_KINDS.map((kind) => (
          <TableRow key={kind}>
            <TableCell className="py-2.5 pl-4 sm:pl-5">{KIND_LABELS[kind]}</TableCell>
            <TableCell>
              <Switch aria-label={`${KIND_LABELS[kind]}: inbox`} checked={kinds[kind].inbox} onCheckedChange={(v) => onChange(kind, "inbox", v)} />
            </TableCell>
            <TableCell className="pr-4 sm:pr-5">
              {pushEnabled ? (
                <Switch aria-label={`${KIND_LABELS[kind]}: push`} checked={kinds[kind].push} onCheckedChange={(v) => onChange(kind, "push", v)} />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} aria-label="Push is not set up" className="inline-flex">
                      <Switch aria-label={`${KIND_LABELS[kind]}: push`} checked={kinds[kind].push} disabled />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{PUSH_OFF}</TooltipContent>
                </Tooltip>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
