"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarDays, MapPin, MoreHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AcceptDialog } from "@/components/events/accept-dialog";
import { CopyPromptsDialog } from "@/components/events/copy-prompts-dialog";
import { LifecycleStepper } from "@/components/events/lifecycle-stepper";
import { CancelDialog, DeleteDialog, LifecycleDialog, type ConfirmKind } from "@/components/events/request-dialogs";
import { StatusBadge, useWhen } from "@/components/events/request-row";
import { PageHeader } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RequestDetail } from "@/lib/ops/requests";
import { useTRPC } from "@/trpc/client";

/** One entry of the More menu: an action or a link. */
interface MenuItem {
  key: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  destructive?: boolean;
}

/** The facts line under the title: status, when, where, requester, linked project and whether the page is read-only. */
function Facts({ detail, tab }: { detail: RequestDetail; tab: string }) {
  const t = useTranslations("events");
  const format = useFormatter();
  const { request, canEdit, projectSlug, projectOpen, requesterName } = detail;
  const time = useWhen(request);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-2">
      <StatusBadge status={request.status} />
      <span className="flex items-center gap-1.5 tabular-nums">
        <CalendarDays aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {request.startsAt ? `${format.dateTime(request.startsAt, { weekday: "short", day: "numeric", month: "short" })}, ${time}` : <span className="text-muted-foreground">{t("header.noDate")}</span>}
      </span>
      {request.where && (
        <span className="flex min-w-0 items-center gap-1.5">
          <MapPin aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{request.where}</span>
        </span>
      )}
      <span title={t("header.requester", { name: requesterName })}>
        <PersonName name={requesterName} />
      </span>
      {request.projectId && projectOpen && projectSlug ? (
        <Link href={`/p/${projectSlug}`} aria-label={t("link.open", { name: projectSlug })} className="border bg-card px-1.5 py-px font-mono text-[12.5px] text-brand-strong hover:underline">
          {projectSlug}
        </Link>
      ) : (
        !request.projectId && request.acceptedAt && <span title={t("link.deletedHelp")} className="text-muted-foreground">{t("link.deleted")}</span>
      )}
      {!canEdit && (
        <Badge variant="outline" title={t("header.viewOnlyHelp")}>
          {t("header.viewOnly")}
        </Badge>
      )}
      {request.status === "event_week" && tab !== "eventday" && (
        <Link href={`/requests/${request.id}?tab=eventday`} className="font-medium text-brand-strong hover:underline">
          {t("page.somethingWrong")}
        </Link>
      )}
    </div>
  );
}

/**
 * The header of a request page: breadcrumbs, title, the facts line, the one primary next step of the lifecycle and a More
 * menu with the rest, then the lifecycle stepper. It owns the confirmation dialogs of the lifecycle. Actions the actor may
 * not use are left out; the primary one is disabled with a reason when the state blocks it.
 *
 * @param props.detail the request with the actor's rights
 * @param props.incomplete the titles of the required fallback scenarios that are not filled in
 * @param props.tab the open tab
 */
export function RequestHeader({ detail, incomplete, tab }: { detail: RequestDetail; incomplete: string[]; tab: string }) {
  const t = useTranslations("events");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const { request, canEdit, canCancel, canAccept, canDevelop, canReopen, canDelete, canManage } = detail;
  const { status, id } = request;
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const submit = useMutation(trpc.requests.submit.mutationOptions({ onSuccess: () => toast.success(t("actions.submitted")) }));
  const recall = useMutation(trpc.requests.recall.mutationOptions({ onSuccess: () => toast.success(t("actions.recalled")) }));
  const busy = submit.isPending || recall.isPending;
  const blocked = status === "accepted" && incomplete.length > 0 ? t("actions.fallbackGate", { scenarios: incomplete.join(", ") }) : null;

  let primary: { label: string; onClick: () => void; blocked?: string | null } | null = null;
  if (status === "draft" && canEdit) primary = { label: t("actions.submit"), onClick: () => submit.mutate({ id }) };
  else if (status === "submitted" && canAccept) primary = { label: t("accept.button"), onClick: () => setAcceptOpen(true) };
  else if (status === "accepted" && (canEdit || canDevelop)) primary = { label: t("actions.startEventWeek"), onClick: () => setConfirm("startWeek"), blocked };
  else if (status === "event_week" && canEdit) primary = { label: t("actions.complete"), onClick: () => setConfirm("complete") };
  else if ((status === "cancelled" || status === "withdrawn") && canReopen) primary = { label: t("actions.reopen"), onClick: () => setConfirm("reopen") };

  const live = status === "accepted" || status === "event_week";
  const items: MenuItem[] = [];
  if (canEdit) items.push({ key: "prompts", label: t("prompts.button"), onSelect: () => setPromptsOpen(true) });
  if (canEdit && status === "submitted") items.push({ key: "recall", label: t("actions.recall"), onSelect: () => recall.mutate({ id }), disabled: busy });
  if (canEdit && (status === "draft" || status === "submitted")) items.push({ key: "withdraw", label: t("actions.withdraw"), onSelect: () => setConfirm("withdraw") });
  if (live || status === "done") items.push({ key: "eventday", label: t("header.eventDay"), href: `/requests/${id}/event-day` });
  if (canManage || canDevelop) items.push({ key: "settings", label: t("header.settings"), href: "/requests/settings" });
  if (canCancel && live) items.push({ key: "cancel", label: t("actions.cancel"), onSelect: () => setCancelOpen(true), destructive: true });
  if (canDelete) items.push({ key: "delete", label: tc("delete"), onSelect: () => setDeleteOpen(true), destructive: true });
  const regular = items.filter((i) => !i.destructive);
  const destructive = items.filter((i) => i.destructive);

  const button = primary && (
    <Button disabled={busy || !!primary.blocked} onClick={primary.onClick}>
      {primary.label}
    </Button>
  );
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("crumb"), href: "/requests" }, { label: request.title }]}
        title={request.title}
        actions={
          <>
            {primary?.blocked ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>{button}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{primary.blocked}</TooltipContent>
              </Tooltip>
            ) : (
              button
            )}
            {items.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t("header.more")} className="text-fg-2">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {regular.map((i) => (
                    <DropdownMenuItem key={i.key} asChild={!!i.href} disabled={i.disabled} onSelect={i.onSelect}>
                      {i.href ? <Link href={i.href}>{i.label}</Link> : i.label}
                    </DropdownMenuItem>
                  ))}
                  {destructive.length > 0 && regular.length > 0 && <DropdownMenuSeparator />}
                  {destructive.map((i) => (
                    <DropdownMenuItem key={i.key} variant="destructive" onSelect={i.onSelect}>
                      {i.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        <Facts detail={detail} tab={tab} />
      </PageHeader>
      <LifecycleStepper requestId={id} status={status} cancelNote={request.cancelNote} canReopen={canReopen} onReopen={() => setConfirm("reopen")} />
      {canEdit && <CopyPromptsDialog requestId={id} open={promptsOpen} onOpenChange={setPromptsOpen} />}
      <LifecycleDialog kind={confirm} requestId={id} status={status} onClose={() => setConfirm(null)} />
      {canCancel && <CancelDialog requestId={id} open={cancelOpen} onOpenChange={setCancelOpen} />}
      {canDelete && <DeleteDialog requestId={id} open={deleteOpen} onOpenChange={setDeleteOpen} />}
      {canAccept && <AcceptDialog request={{ id, title: request.title, startsAt: request.startsAt, endsAt: request.endsAt }} open={acceptOpen} onOpenChange={setAcceptOpen} />}
    </>
  );
}
