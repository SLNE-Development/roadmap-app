"use client";

import { useMutation } from "@tanstack/react-query";
import { useTimeZone, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { DirtyBar } from "@/components/events/dirty-bar";
import { ImageUpload } from "@/components/events/image-upload";
import { RequestRail } from "@/components/events/request-rail";
import { Panel } from "@/components/page";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RequestDetail } from "@/lib/ops/requests";
import { fromZonedInput, toZonedInput } from "@/lib/zoned-time";
import { useTRPC } from "@/trpc/client";

/** The longest short description the server accepts. */
const SUMMARY_MAX = 500;

/** The short description: plain text with a counter, saved on its own. */
function SummaryCard({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.summary");
  const trpc = useTRPC();
  const id = useId();
  const { request, canEdit } = detail;
  // Both start from the server once; a refetch never overwrites what is typed, and a save adopts the saved text.
  const [saved, setSaved] = useState(request.summary);
  const [draft, setDraft] = useState(request.summary);
  const update = useMutation(
    trpc.requests.update.mutationOptions({
      onSuccess: (_row, vars) => {
        setSaved(vars.summary ?? "");
        toast.success(t("saved"));
      },
    }),
  );
  return (
    <Panel title={t("title")} bodyClassName="gap-2 pb-0">
      <div className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
        {canEdit ? (
          <>
            <p id={`${id}-help`} className="text-[13px] text-fg-2">
              {t("help")}
            </p>
            <Textarea aria-label={t("label")} aria-describedby={`${id}-help`} className="min-h-24" value={draft} maxLength={SUMMARY_MAX} onChange={(e) => setDraft(e.target.value)} />
            <span className="self-end text-xs text-muted-foreground tabular-nums">{t("counter", { count: draft.length, max: SUMMARY_MAX })}</span>
          </>
        ) : request.summary ? (
          <p className="text-[14px] leading-[1.55] whitespace-pre-wrap">{request.summary}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
        )}
      </div>
      <DirtyBar
        dirty={canEdit && draft.trim() !== saved.trim()}
        canSave
        pending={update.isPending}
        onSave={() => update.mutate({ id: request.id, summary: draft.trim() })}
        onDiscard={() => setDraft(saved)}
      />
    </Panel>
  );
}

/** The values of the details form: the two times are `datetime-local` text in the viewer's time zone. */
interface DetailsDraft {
  title: string;
  start: string;
  end: string;
  where: string;
  docs: string;
}

/** The details: title, start, end, where and documents link, saving only what changed. */
function DetailsCard({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.details");
  const trpc = useTRPC();
  const zone = useTimeZone() ?? "UTC";
  const id = useId();
  const { request, canEdit } = detail;
  const initial: DetailsDraft = {
    title: request.title,
    start: request.startsAt ? toZonedInput(request.startsAt, zone) : "",
    end: request.endsAt ? toZonedInput(request.endsAt, zone) : "",
    where: request.where,
    docs: request.eventDocsUrl ?? "",
  };
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const update = useMutation(
    trpc.requests.update.mutationOptions({
      // The baseline is what was sent; text typed while the save ran stays unsaved.
      onSuccess: (_row, vars) => {
        setSaved((s) => ({
          title: vars.title ?? s.title,
          start: vars.startsAt === undefined ? s.start : vars.startsAt ? toZonedInput(new Date(vars.startsAt), zone) : "",
          end: vars.endsAt === undefined ? s.end : vars.endsAt ? toZonedInput(new Date(vars.endsAt), zone) : "",
          where: vars.where ?? s.where,
          docs: vars.eventDocsUrl === undefined ? s.docs : (vars.eventDocsUrl ?? ""),
        }));
        toast.success(t("saved"));
      },
    }),
  );
  const set = (field: keyof DetailsDraft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));
  // Moving the start moves the end by the same time, so the event keeps its length.
  const setStart = (value: string) =>
    setDraft((d) => {
      const before = fromZonedInput(d.start, zone);
      const after = fromZonedInput(value, zone);
      const end = fromZonedInput(d.end, zone);
      if (value === "") return { ...d, start: value, end: "" };
      if (!before || !after || !end) return { ...d, start: value };
      return { ...d, start: value, end: toZonedInput(new Date(end.getTime() + after.getTime() - before.getTime()), zone) };
    });

  const start = fromZonedInput(draft.start, zone);
  const end = fromZonedInput(draft.end, zone);
  const endBeforeStart = start !== null && end !== null && end.getTime() <= start.getTime();
  const invalid = !draft.title.trim() || (draft.start !== "" && start === null) || (draft.end !== "" && end === null) || endBeforeStart;
  // Text is saved trimmed, so trailing spaces alone are no change.
  const changed = (k: keyof DetailsDraft) => draft[k].trim() !== saved[k].trim();
  const dirty = (Object.keys(draft) as (keyof DetailsDraft)[]).some(changed);
  const patch = {
    ...(changed("title") ? { title: draft.title.trim() } : {}),
    ...(changed("start") ? { startsAt: start } : {}),
    ...(changed("end") ? { endsAt: end } : {}),
    ...(changed("where") ? { where: draft.where.trim() } : {}),
    ...(changed("docs") ? { eventDocsUrl: draft.docs.trim() || null } : {}),
  };
  return (
    <div id="request-details">
      <Panel title={t("title")} bodyClassName="pb-0">
        <FieldGroup className="px-4 pb-4 sm:px-5">
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>{t("name")}</FieldLabel>
            <Input id={`${id}-title`} value={draft.title} maxLength={120} disabled={!canEdit} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-starts`}>{t("startsAt")}</FieldLabel>
              <Input id={`${id}-starts`} type="datetime-local" value={draft.start} disabled={!canEdit} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field data-invalid={endBeforeStart || undefined}>
              <FieldLabel htmlFor={`${id}-ends`}>{t("endsAt")}</FieldLabel>
              <Input id={`${id}-ends`} type="datetime-local" value={draft.end} disabled={!canEdit || draft.start === ""} aria-invalid={endBeforeStart || undefined} onChange={(e) => set("end")(e.target.value)} />
            </Field>
            <FieldDescription className="sm:col-span-2" role={endBeforeStart ? "alert" : undefined}>
              {endBeforeStart ? t("endBeforeStart") : t("startsAtHelp", { zone })}
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-where`}>{t("where")}</FieldLabel>
            <Input id={`${id}-where`} value={draft.where} maxLength={200} disabled={!canEdit} onChange={(e) => set("where")(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-docs`}>{t("docs")}</FieldLabel>
            <Input id={`${id}-docs`} type="url" value={draft.docs} maxLength={500} disabled={!canEdit} onChange={(e) => set("docs")(e.target.value)} />
            <FieldDescription>{t("docsHelp")}</FieldDescription>
          </Field>
        </FieldGroup>
        <DirtyBar dirty={canEdit && dirty} canSave={!invalid} pending={update.isPending} onSave={() => update.mutate({ id: request.id, ...patch })} onDiscard={() => setDraft(saved)} />
      </Panel>
    </div>
  );
}

/** The banner picker: uploads an image, makes it the banner and deletes the one it replaces. */
function BannerCard({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.banner");
  const trpc = useTRPC();
  const { request, canEdit } = detail;
  const set = useMutation(trpc.requests.setBanner.mutationOptions());
  const remove = useMutation(trpc.requests.deleteUpload.mutationOptions({ onSuccess: () => toast.success(t("removed")) }));
  const current = request.bannerUploadId;
  return (
    <Panel title={t("title")} bodyClassName="gap-3 px-4 pb-4 sm:px-5">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      <ImageUpload
        requestId={request.id}
        purpose="banner"
        image={current ? { id: current, url: `/api/uploads/${current}` } : null}
        disabled={!canEdit}
        onUploaded={async (image) => {
          await set.mutateAsync({ requestId: request.id, uploadId: image.id });
          toast.success(t("saved"));
          if (current) remove.mutate({ id: current });
        }}
        onRemove={(id) => remove.mutate({ id })}
      />
    </Panel>
  );
}

/**
 * The Overview tab: the short description, the details and the banner in the main column, the rail beside them (below on
 * phones). Every card keeps its own draft and saves on its own.
 *
 * @param props.detail the request with the actor's rights
 */
export function RequestOverview({ detail }: { detail: RequestDetail }) {
  const id = detail.request.id;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-5">
        <SummaryCard key={`summary-${id}`} detail={detail} />
        <DetailsCard key={`details-${id}`} detail={detail} />
        <BannerCard key={`banner-${id}`} detail={detail} />
      </div>
      <RequestRail detail={detail} />
    </div>
  );
}
