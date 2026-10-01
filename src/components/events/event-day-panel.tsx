"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHECKLIST_TEMPLATE } from "@/lib/event-prep-template";
import { useTRPC } from "@/trpc/client";
import { DisasterPanel } from "./disaster-panel";

/** The template keys of the checklist, which have a translated label. */
const TEMPLATE_KEYS: readonly string[] = CHECKLIST_TEMPLATE.map((c) => c.key);

/**
 * The event-day view: the event, the checklist, who is checked in and the "Something is wrong" panel with the fallback
 * scenarios. Used by the Event day tab and by the event-day page. The disaster panel posts and resolves the disaster message.
 *
 * @param props.requestId the request
 * @param props.canManageList whether the actor may add and remove custom checklist items
 */
export function EventDayPanel({ requestId, canManageList = false }: { requestId: string; canManageList?: boolean }) {
  const t = useTranslations("events.eventDay");
  const trpc = useTRPC();
  const format = useFormatter();
  const id = useId();
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const { data: view } = useSuspenseQuery(trpc.requests.eventDay.queryOptions({ id: requestId }));
  const tick = useMutation(trpc.requests.setChecklistItem.mutationOptions());
  const addItem = useMutation(trpc.requests.addChecklistItem.mutationOptions({ onSuccess: () => setLabel("") }));
  const removeItem = useMutation(trpc.requests.removeChecklistItem.mutationOptions());
  const checkIn = useMutation(trpc.requests.checkIn.mutationOptions());
  const checkOut = useMutation(trpc.requests.checkOut.mutationOptions());
  const live = view.request.status === "event_week";
  const time = (at: Date) => format.dateTime(at, { timeStyle: "short" });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 border bg-card px-4 py-3 text-[13.5px]">
        <h2 className="text-[15px] font-semibold">{view.request.title}</h2>
        {view.request.startsAt && <time dateTime={view.request.startsAt.toISOString()}>{format.dateTime(view.request.startsAt, { dateStyle: "full", timeStyle: "short" })}</time>}
        {view.request.where && <p className="text-fg-2">{t("where", { where: view.request.where })}</p>}
        {!live && <p className="text-muted-foreground">{t("notLive")}</p>}
      </div>

      <Panel title={t("checklist")} bodyClassName="gap-3 px-4 pb-4 sm:px-5">
        {!view.canTick && live && <p className="text-[13px] text-fg-2">{t("readOnly")}</p>}
        <ul className="flex flex-col gap-2">
          {view.checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-[13.5px]">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={item.doneAt !== null}
                  disabled={!view.canTick || tick.isPending}
                  onChange={(e) => tick.mutate({ itemId: item.id, done: e.target.checked })}
                />
                {item.key && TEMPLATE_KEYS.includes(item.key) ? t(`items.${item.key as (typeof CHECKLIST_TEMPLATE)[number]["key"]}`) : item.label}
              </label>
              {canManageList && item.key === null && (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeItem.mutate({ itemId: item.id })}>
                  {t("removeItem")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canManageList && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addItem.mutate({ id: requestId, label });
            }}
          >
            <label htmlFor={id} className="sr-only">
              {t("newItem")}
            </label>
            <Input id={id} className="max-w-sm" placeholder={t("newItem")} value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
            <Button type="submit" variant="outline" disabled={addItem.isPending || !label.trim()}>
              {t("addItem")}
            </Button>
          </form>
        )}
      </Panel>

      <Panel title={t("checkins")} bodyClassName="gap-3 px-4 pb-4 sm:px-5">
        {view.checkins.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("nobody")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13.5px]">
            {view.checkins.map((c) => (
              <li key={c.userId}>{t("checkedInAt", { name: c.name, time: time(c.at) })}</li>
            ))}
          </ul>
        )}
        {live && (
          <div>
            {view.checkedIn ? (
              <Button type="button" variant="outline" disabled={checkOut.isPending} onClick={() => checkOut.mutate({ id: requestId })}>
                {t("checkOut")}
              </Button>
            ) : (
              <Button type="button" disabled={checkIn.isPending} onClick={() => checkIn.mutate({ id: requestId })}>
                {t("checkIn")}
              </Button>
            )}
          </div>
        )}
      </Panel>

      <Panel title={t("wrong")} bodyClassName="gap-3 px-4 pb-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? t("hideScenarios") : t("showScenarios")}
          </Button>
        </div>
        <DisasterPanel requestId={requestId} />
        {open && (
          <ul className="flex flex-col gap-3">
            {view.fallbacks.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 border bg-card px-3 py-2.5 text-[13.5px]">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="whitespace-pre-wrap">{f.whatWeDo || t("blank")}</p>
                <p className="text-fg-2">{t("decides", { who: f.whoDecides || t("blank") })}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
