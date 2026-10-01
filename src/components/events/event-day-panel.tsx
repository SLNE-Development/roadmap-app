"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Copy, Plus, Timer, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { DisasterPanel } from "@/components/events/disaster-panel";
import { Markdown } from "@/components/markdown";
import { EmptyState, Panel, ProgressBar } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { fillPlaceholders, placeholderValues } from "@/lib/event-placeholders";
import type { EventDayView } from "@/lib/ops/request-prep";
import { useRelativeTime } from "@/lib/use-relative-time";
import { useTRPC } from "@/trpc/client";

/** The event card: how far away the start is or whether the event runs (the clock moves every minute), and a hint before the event week. */
function EventCard({ request }: { request: EventDayView["request"] }) {
  const t = useTranslations("events.eventDay");
  const format = useFormatter();
  const now = useNow();
  const endsAt = request.startsAt && request.durationMinutes ? new Date(request.startsAt.getTime() + request.durationMinutes * 60_000) : null;
  let countdown: string | null = null;
  if (request.startsAt) {
    if (request.startsAt.getTime() > now.getTime()) countdown = t("startsIn", { when: format.relativeTime(request.startsAt, now) });
    else if (!endsAt || endsAt.getTime() > now.getTime()) countdown = t("running");
    else countdown = t("endedAgo", { when: format.relativeTime(endsAt, now) });
  }
  if (!countdown && request.status === "event_week") return null;
  return (
    <div className="flex flex-col gap-1 border bg-card px-4 py-4 sm:px-5">
      {countdown && (
        <p className="flex items-center gap-1.5 font-display text-[19px] font-semibold tabular-nums text-brand-strong">
          <Timer aria-hidden className="size-[18px]" />
          {countdown}
        </p>
      )}
      {request.status !== "event_week" && <p className="text-[13px] text-muted-foreground">{t("notLive")}</p>}
    </div>
  );
}

/** The checklist: ticking (event week), who ticked and when, removing custom items and adding one inline. */
function Checklist({ requestId, view, canManageList }: { requestId: string; view: EventDayView; canManageList: boolean }) {
  const t = useTranslations("events.eventDay");
  const trpc = useTRPC();
  const format = useFormatter();
  const ago = useRelativeTime();
  const id = useId();
  const [label, setLabel] = useState("");
  const tick = useMutation(trpc.requests.setChecklistItem.mutationOptions());
  const addItem = useMutation(trpc.requests.addChecklistItem.mutationOptions({ onSuccess: () => setLabel("") }));
  const removeItem = useMutation(trpc.requests.removeChecklistItem.mutationOptions());
  const done = view.checklist.filter((c) => c.doneAt !== null).length;
  const live = view.request.status === "event_week";
  return (
    <Panel
      title={t("checklist")}
      meta={view.checklist.length > 0 ? t("progress", { done, total: view.checklist.length }) : undefined}
      bodyClassName="gap-4 px-4 pb-4 sm:px-5"
    >
      {view.checklist.length > 0 && <ProgressBar value={done} total={view.checklist.length} colorClass="bg-cat-done" />}
      {!view.canTick && live && <p className="text-[13px] text-fg-2">{t("readOnly")}</p>}
      {view.checklist.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={
            canManageList
              ? t.rich("emptyText", { id: requestId, code: (chunks) => <code className="bg-secondary px-1 font-mono text-[12px] break-all">{chunks}</code> })
              : t("emptyTextReadOnly")
          }
        />
      ) : (
        <ul className="flex flex-col divide-y border-y">
          {view.checklist.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2.5">
              <label className="flex min-w-0 flex-1 items-start gap-3 text-[13.5px]">
                <Checkbox className="mt-0.5" checked={item.doneAt !== null} disabled={!view.canTick || tick.isPending} onCheckedChange={(checked) => tick.mutate({ itemId: item.id, done: checked === true })} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={item.doneAt ? "text-muted-foreground line-through" : undefined}>{item.label}</span>
                  {item.doneAt && (
                    <span className="text-[12px] text-muted-foreground" title={format.dateTime(item.doneAt, { dateStyle: "medium", timeStyle: "short" })}>
                      {item.doneByName ? t("doneBy", { name: item.doneByName, when: ago(item.doneAt) }) : t("doneAt", { when: ago(item.doneAt) })}
                    </span>
                  )}
                </span>
              </label>
              {canManageList && item.key === null && (
                <Button type="button" size="icon-xs" variant="ghost" aria-label={t("removeItemNamed", { label: item.label })} title={t("removeItem")} disabled={removeItem.isPending} onClick={() => removeItem.mutate({ itemId: item.id })}>
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManageList && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) addItem.mutate({ id: requestId, label });
          }}
        >
          <label htmlFor={id} className="sr-only">
            {t("newItem")}
          </label>
          <Input id={id} className="min-w-0 flex-1" placeholder={t("newItem")} value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" variant="outline" disabled={addItem.isPending || !label.trim()}>
            <Plus aria-hidden />
            {t("addItem")}
          </Button>
        </form>
      )}
    </Panel>
  );
}

/** One fallback scenario, always open: what we do, who decides and the player message with a Copy button. */
function Scenario({ scenario, request, timeZone }: { scenario: EventDayView["fallbacks"][number]; request: EventDayView["request"]; timeZone: string }) {
  const t = useTranslations("events.eventDay");
  const message = scenario.playerMessage
    ? fillPlaceholders(scenario.playerMessage, placeholderValues({ title: request.title, startsAt: request.startsAt, durationMinutes: request.durationMinutes, where: request.where, eventDocsUrl: null }, { timeZone, rulebookUrl: null }))
    : null;
  return (
    <Panel title={scenario.title} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-semibold">{t("whatWeDo")}</h3>
        {scenario.whatWeDo.trim() ? <Markdown className="text-[13.5px]">{scenario.whatWeDo}</Markdown> : <p className="text-[13.5px] text-muted-foreground">{t("blank")}</p>}
      </div>
      <p className="text-[13px] text-fg-2">{t("decides", { who: scenario.whoDecides || t("blank") })}</p>
      {message && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold">{t("playerMessage")}</h3>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message);
                  toast.success(t("copied"));
                } catch {
                  toast.error(t("copyFailed"));
                }
              }}
            >
              <Copy aria-hidden />
              {t("copy")}
              <span className="sr-only"> ({scenario.title})</span>
            </Button>
          </div>
          <p className="border-l-2 border-primary bg-secondary px-3 py-2 text-[13.5px] whitespace-pre-wrap">{message}</p>
        </div>
      )}
    </Panel>
  );
}

/**
 * The Event day tab: the event card (countdown), the checklist, the fallback scenarios and the disaster panel. On wide screens the
 * disaster panel sits in a column of its own, on phones it comes first so it is never below the fold.
 *
 * @param props.requestId the request
 * @param props.canManageList whether the actor may add and remove custom checklist items
 */
export function EventDayPanel({ requestId, canManageList = false }: { requestId: string; canManageList?: boolean }) {
  const t = useTranslations("events.eventDay");
  const trpc = useTRPC();
  const { data: view } = useSuspenseQuery(trpc.requests.eventDay.queryOptions({ id: requestId }));
  return (
    <div className="flex flex-col gap-5">
      <EventCard request={view.request} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5 max-lg:order-last">
          <Checklist requestId={requestId} view={view} canManageList={canManageList} />
          <h2 className="font-display text-[19px] font-semibold">{t("fallbacks")}</h2>
          {view.fallbacks.length === 0 && <EmptyState title={t("fallbacksEmptyTitle")} description={t("fallbacksEmptyText")} />}
          {view.fallbacks.map((f) => (
            <Scenario key={f.id} scenario={f} request={view.request} timeZone={view.timeZone} />
          ))}
        </div>
        <DisasterPanel requestId={requestId} />
      </div>
    </div>
  );
}
