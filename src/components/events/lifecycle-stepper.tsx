"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Ban, Check, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/event-status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The statuses of a request's normal life, in order. */
const STEPS = ["draft", "submitted", "accepted", "event_week", "done"] as const;

/** Returns whether `value` is a request status. */
const isStatus = (value: string | null): value is RequestStatus => REQUEST_STATUSES.includes(value as RequestStatus);

/**
 * The strip of a cancelled or withdrawn request: the status, who did it and when (from the history), the cancel note as
 * Markdown and the Reopen button for those who may reopen.
 */
function ClosedStrip({ requestId, status, cancelNote, canReopen, onReopen }: { requestId: string; status: "cancelled" | "withdrawn"; cancelNote: string | null; canReopen: boolean; onReopen: () => void }) {
  const t = useTranslations("events");
  const format = useFormatter();
  const trpc = useTRPC();
  const { data: rows } = useSuspenseQuery(trpc.requests.history.queryOptions({ id: requestId }));
  // A cancel logs the reason as its new value, so it is the status change whose new value is no status.
  const entry = rows.find((r) => r.field === "status" && (status === "cancelled" ? isStatus(r.oldValue) && !isStatus(r.newValue) : r.newValue === status));
  const Icon = status === "cancelled" ? Ban : Undo2;
  return (
    <section aria-label={t("statusBar.label")} className={cn("flex flex-wrap items-start gap-x-4 gap-y-3 border px-4 py-3.5", status === "cancelled" ? "bg-danger-soft" : "bg-secondary")}>
      <span className={cn("flex size-7 shrink-0 items-center justify-center", status === "cancelled" ? "text-destructive" : "text-fg-2")}>
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
        <h2 className="text-sm font-semibold">
          {entry ? t("closed.by", { status: t(`closed.${status}`), name: entry.author, date: format.dateTime(entry.createdAt, { dateStyle: "medium" }) }) : t(`closed.${status}`)}
        </h2>
        {status === "cancelled" && (cancelNote ? <Markdown className="text-[13.5px]">{cancelNote}</Markdown> : <p className="text-[13px] text-fg-2">{t("closed.noNote")}</p>)}
      </div>
      {canReopen && (
        <Button variant="outline" onClick={onReopen}>
          {t("actions.reopen")}
        </Button>
      )}
    </section>
  );
}

/**
 * The lifecycle of a request as five steps (draft, submitted, accepted, event week, done) with the reached ones filled
 * and the current one marked. A cancelled or withdrawn request shows a strip with the status, the note and the Reopen button instead.
 *
 * @param props.status the request's status
 * @param props.cancelNote the reason of a cancelled request
 * @param props.canReopen whether the actor may reopen the request
 * @param props.onReopen called by the Reopen button
 */
export function LifecycleStepper({ requestId, status, cancelNote, canReopen, onReopen }: { requestId: string; status: RequestStatus; cancelNote: string | null; canReopen: boolean; onReopen: () => void }) {
  const t = useTranslations("events");
  if (status === "cancelled" || status === "withdrawn") return <ClosedStrip requestId={requestId} status={status} cancelNote={cancelNote} canReopen={canReopen} onReopen={onReopen} />;
  const reached = STEPS.indexOf(status);
  return (
    <div className="flex flex-col gap-2 border bg-card px-2 py-3.5 sm:px-4">
    <ol aria-label={t("statusBar.label")} className="grid grid-cols-5">
      {STEPS.map((step, i) => {
        const state = i < reached || status === "done" ? "done" : i === reached ? "current" : "upcoming";
        const label = t(`status.${step}`);
        return (
          <li key={step} aria-current={state === "current" ? "step" : undefined} className="relative flex min-w-0 flex-col items-center gap-1.5">
            {i > 0 && <span aria-hidden className={cn("absolute top-[11px] right-1/2 z-0 h-px w-full", i <= reached || status === "done" ? "bg-primary" : "bg-border")} />}
            <span
              aria-hidden
              className={cn(
                "relative z-10 flex size-[22px] items-center justify-center rounded-full border text-[11px] font-semibold",
                state === "done" && "border-primary bg-primary text-primary-foreground",
                state === "current" && "border-primary bg-brand-soft text-brand-strong ring-4 ring-brand-soft",
                state === "upcoming" && "bg-card text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("max-w-full truncate px-0.5 text-center text-[12.5px] max-sm:sr-only", state === "current" ? "font-semibold text-foreground" : state === "done" ? "font-medium text-fg-2" : "text-muted-foreground")}>{label}</span>
            <span className="sr-only">{t(`statusBar.${state}`, { status: label })}</span>
          </li>
        );
      })}
    </ol>
    <p aria-hidden className="text-center text-[13px] font-semibold sm:hidden">{t(`status.${status}`)}</p>
    </div>
  );
}
