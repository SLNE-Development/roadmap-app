"use client";

import { useMutation, useQueryClient, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { UnderlineTabs } from "@/components/activity/url-tabs";
import { AcceptDialog } from "@/components/events/accept-dialog";
import { BriefHistory } from "@/components/events/brief-history";
import { ImageUpload } from "@/components/events/image-upload";
import { EventDayPanel } from "@/components/events/event-day-panel";
import { FallbackTab } from "@/components/events/fallback-tab";
import { MessagesTab } from "@/components/events/post-composer";
import { PrepTab } from "@/components/events/prep-tab";
import { EventProgressBar } from "@/components/events/progress-bar";
import { openCount, QuestionForm } from "@/components/events/question-form";
import { StatusBar } from "@/components/events/status-bar";
import { Markdown } from "@/components/markdown";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/event-status";
import type { RequestDetail } from "@/lib/ops/requests";
import { fromZonedInput, toZonedInput } from "@/lib/zoned-time";
import { useTRPC } from "@/trpc/client";

/** The statuses in which the brief is edited. */
const BRIEF_EDITABLE: readonly RequestStatus[] = ["draft", "submitted", "accepted", "event_week"];

/** Returns whether `value` is a request status. */
const isStatus = (value: string | null): value is RequestStatus => REQUEST_STATUSES.includes(value as RequestStatus);

/** The Brief tab's editor: a markdown textarea saving new versions, with a conflict message and a reload button. */
function BriefEditor({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.brief");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const id = useId();
  const requestId = detail.request.id;
  const [body, setBody] = useState(detail.brief);
  const [base, setBase] = useState(detail.request.briefVersion);
  const [conflict, setConflict] = useState(false);
  // A conflict shows its own message and a Reload button, so the generic error toast is skipped.
  const save = useMutation(
    trpc.requests.saveBrief.mutationOptions({
      meta: { quiet: true },
      onSuccess: ({ version, changed }) => {
        setConflict(false);
        setBase(version);
        toast.success(changed ? t("saved", { version }) : t("unchanged"));
      },
      onError: (error) => {
        if (error.data?.code === "CONFLICT") setConflict(true);
        else toast.error(error.message);
      },
    }),
  );
  const reload = async () => {
    const latest = await queryClient.fetchQuery({ ...trpc.requests.get.queryOptions({ id: requestId }), staleTime: 0 });
    setBody(latest.brief);
    setBase(latest.request.briefVersion);
    setConflict(false);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: requestId, body, baseVersion: base });
      }}
    >
      <label htmlFor={id} className="text-[13px] text-fg-2">
        {t("help")}
      </label>
      <Textarea id={id} className="min-h-[320px] font-mono text-[13px]" value={body} maxLength={50_000} onChange={(e) => setBody(e.target.value)} />
      {conflict && (
        <p role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/40 bg-danger-soft px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1">{t("conflict")}</span>
          <Button type="button" size="sm" variant="outline" onClick={reload}>
            {t("reload")}
          </Button>
        </p>
      )}
      <div>
        <Button type="submit" disabled={save.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

/** The Overview tab's details form: title, start, duration, place and documents link, saving only what changed. */
function DetailsForm({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.details");
  const trpc = useTRPC();
  const zone = useTimeZone() ?? "UTC";
  const id = useId();
  const { request, canEdit } = detail;
  const [title, setTitle] = useState(request.title);
  const [startsAt, setStartsAt] = useState(request.startsAt ? toZonedInput(request.startsAt, zone) : "");
  const [duration, setDuration] = useState(request.durationMinutes?.toString() ?? "");
  const [where, setWhere] = useState(request.where);
  const [docs, setDocs] = useState(request.eventDocsUrl ?? "");
  const update = useMutation(trpc.requests.update.mutationOptions({ onSuccess: () => toast.success(t("saved")) }));

  const start = startsAt ? fromZonedInput(startsAt, zone) : null;
  const minutes = duration.trim() ? Number(duration) : null;
  const patch = {
    ...(title.trim() !== request.title ? { title } : {}),
    ...(startsAt !== (request.startsAt ? toZonedInput(request.startsAt, zone) : "") ? { startsAt: start } : {}),
    ...(minutes !== request.durationMinutes ? { durationMinutes: minutes } : {}),
    ...(where.trim() !== request.where ? { where } : {}),
    ...((docs.trim() || null) !== request.eventDocsUrl ? { eventDocsUrl: docs.trim() || null } : {}),
  };
  return (
    <form
      className="flex flex-col gap-4 px-4 pb-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ id: request.id, ...patch });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-title`}>{t("name")}</FieldLabel>
          <Input id={`${id}-title`} value={title} maxLength={120} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-starts`}>{t("startsAt")}</FieldLabel>
            <Input id={`${id}-starts`} type="datetime-local" value={startsAt} disabled={!canEdit} onChange={(e) => setStartsAt(e.target.value)} />
            <FieldDescription>{t("startsAtHelp")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-duration`}>{t("duration")}</FieldLabel>
            <Input id={`${id}-duration`} type="number" min={5} max={1440} value={duration} disabled={!canEdit} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-where`}>{t("where")}</FieldLabel>
          <Input id={`${id}-where`} value={where} maxLength={200} disabled={!canEdit} onChange={(e) => setWhere(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-docs`}>{t("docs")}</FieldLabel>
          <Input id={`${id}-docs`} type="url" value={docs} maxLength={500} disabled={!canEdit} onChange={(e) => setDocs(e.target.value)} />
          <FieldDescription>{t("docsHelp")}</FieldDescription>
        </Field>
      </FieldGroup>
      {canEdit && (
        <div>
          <Button type="submit" disabled={update.isPending || !title.trim() || Object.keys(patch).length === 0 || (startsAt !== "" && start === null)}>
            {t("save")}
          </Button>
        </div>
      )}
    </form>
  );
}

/** The Overview tab's banner picker: uploads an image, makes it the banner and deletes the one it replaces. */
function BannerPanel({ detail }: { detail: RequestDetail }) {
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

/** The history of a request as sentences, newest first. */
function HistoryList({ requestId }: { requestId: string }) {
  const t = useTranslations("events");
  const format = useFormatter();
  const trpc = useTRPC();
  const { data: rows } = useSuspenseQuery(trpc.requests.history.queryOptions({ id: requestId }));
  const when = (at: Date) => format.dateTime(at, { dateStyle: "medium", timeStyle: "short" });
  const status = (value: string | null) => (isStatus(value) ? t(`status.${value}`) : (value ?? ""));
  const sentence = (r: (typeof rows)[number]) => {
    const name = r.author;
    if (r.field === "created") return t("history.created", { name });
    if (r.field === "brief") return t("history.brief", { name, from: r.oldValue ?? "", to: r.newValue ?? "" });
    if (r.field === "status") {
      if (isStatus(r.oldValue) && !isStatus(r.newValue)) return t("history.cancelled", { name, reason: r.newValue ?? "" });
      return t("history.status", { name, from: status(r.oldValue), to: status(r.newValue) });
    }
    const known = ["title", "startsAt", "durationMinutes", "where", "eventDocsUrl", "requesterId"] as const;
    const field = known.find((k) => k === r.field);
    return t("history.entry", { name, field: field ? t(`history.field.${field}`) : r.field });
  };
  return (
    <Panel title={t("history.title")} bodyClassName="px-4 pb-4 sm:px-5">
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("history.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">{sentence(r)}</span>
              <time dateTime={r.createdAt.toISOString()} className="text-xs text-muted-foreground">
                {when(r.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The linked project and system as a card for people who may open the project, or the note that the project is gone. */
function LinkCard({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.link");
  const { request, projectSlug, projectOpen } = detail;
  if (!request.projectId) {
    // A project deletion clears the link; an accepted request without a project lost it.
    if (!request.acceptedAt) return null;
    return (
      <div role="status" className="border bg-secondary px-3 py-2 text-[13px]">
        <p className="font-semibold">{t("deleted")}</p>
        <p className="text-fg-2">{t("deletedHelp")}</p>
      </div>
    );
  }
  if (!projectOpen || !projectSlug) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border bg-card px-4 py-3 text-[13.5px]">
      <span className="font-semibold">{t("title")}</span>
      <Link href={`/p/${projectSlug}`} aria-label={t("open", { name: projectSlug })} className="font-mono text-brand-strong hover:underline">
        {`/p/${projectSlug}`}
      </Link>
    </div>
  );
}

/** The build progress of the linked project; renders nothing while the request has no project. */
function ProgressPanel({ requestId }: { requestId: string }) {
  const trpc = useTRPC();
  const { data: progress } = useSuspenseQuery(trpc.requests.progress.queryOptions({ id: requestId }));
  return progress ? <EventProgressBar progress={progress} /> : null;
}

/** The dialog that asks why an event is cancelled. */
function CancelDialog({ requestId, open, onOpenChange }: { requestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("events.actions");
  const trpc = useTRPC();
  const id = useId();
  const [reason, setReason] = useState("");
  const cancel = useMutation(
    trpc.requests.cancel.mutationOptions({
      onSuccess: () => {
        onOpenChange(false);
        setReason("");
        toast.success(t("cancelled"));
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate({ id: requestId, reason });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelDescription")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={id}>{t("reason")}</FieldLabel>
            <Textarea id={id} value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("keep")}
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={cancel.isPending || !reason.trim()}>
              {t("cancelConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The page of one event request: title and status bar, the actions the actor may use, and the Brief and
 * Overview tabs. A request the actor can only view renders read-only.
 *
 * @param props.id the request id
 * @param props.tab the tab shown
 */
export function RequestView({ id, tab }: { id: string; tab: "brief" | "questions" | "overview" | "fallback" | "prep" | "eventday" | "messages" }) {
  const t = useTranslations("events");
  const trpc = useTRPC();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [{ data: detail }, { data: rounds }, { data: fallbacks }] = useSuspenseQueries({
    queries: [trpc.requests.get.queryOptions({ id }), trpc.requests.rounds.queryOptions({ id }), trpc.requests.fallbacks.queryOptions({ id })],
  });
  const { request, canEdit, canCancel, canAccept, canDevelop } = detail;
  const done = (key: "submitted" | "recalled" | "withdrawn" | "done" | "eventWeekStarted") => ({ onSuccess: () => toast.success(t(`actions.${key}`)) });
  const submit = useMutation(trpc.requests.submit.mutationOptions(done("submitted")));
  const recall = useMutation(trpc.requests.recall.mutationOptions(done("recalled")));
  const withdraw = useMutation(trpc.requests.withdraw.mutationOptions(done("withdrawn")));
  const markDone = useMutation(trpc.requests.markDone.mutationOptions(done("done")));
  const startWeek = useMutation(trpc.requests.startEventWeek.mutationOptions(done("eventWeekStarted")));
  const busy = submit.isPending || recall.isPending || withdraw.isPending || markDone.isPending || startWeek.isPending;
  const incomplete = fallbacks.filter((f) => f.required && (!f.whatWeDo.trim() || !f.whoDecides.trim()));
  const { status } = request;
  const open = openCount(rounds);
  const base = `/requests/${id}`;

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb"), href: "/requests" }, { label: request.title }]}
        title={request.title}
        description={t("page.requestedBy", { name: detail.requesterName })}
        actions={
          <>
            {canEdit && status === "draft" && (
              <Button disabled={busy} onClick={() => submit.mutate({ id })}>
                {t("actions.submit")}
              </Button>
            )}
            {canEdit && status === "submitted" && (
              <Button variant="outline" disabled={busy} onClick={() => recall.mutate({ id })}>
                {t("actions.recall")}
              </Button>
            )}
            {canEdit && (status === "draft" || status === "submitted") && (
              <Button variant="outline" disabled={busy} onClick={() => withdraw.mutate({ id })}>
                {t("actions.withdraw")}
              </Button>
            )}
            {canAccept && status === "submitted" && (
              <Button disabled={busy} onClick={() => setAcceptOpen(true)}>
                {t("accept.button")}
              </Button>
            )}
            {(canEdit || canDevelop) && status === "accepted" && (
              <Button disabled={busy} onClick={() => startWeek.mutate({ id })}>
                {t("actions.startEventWeek")}
              </Button>
            )}
            {canEdit && status === "event_week" && (
              <Button disabled={busy} onClick={() => markDone.mutate({ id })}>
                {t("actions.markDone")}
              </Button>
            )}
            {canCancel && (status === "accepted" || status === "event_week") && (
              <Button variant="destructive" disabled={busy} onClick={() => setCancelOpen(true)}>
                {t("actions.cancel")}
              </Button>
            )}
          </>
        }
      >
        <StatusBar status={status} />
      </PageHeader>
      {(canEdit || canDevelop) && status === "accepted" && incomplete.length > 0 && (
        <p role="status" className="border border-primary/40 bg-secondary px-3 py-2 text-[13px]">
          {t("actions.fallbackGate", { scenarios: incomplete.map((f) => f.title).join(", ") })}{" "}
          {tab !== "fallback" && (
            <Link href={`${base}?tab=fallback`} className="text-brand-strong hover:underline">
              {t("actions.openFallback")}
            </Link>
          )}
        </p>
      )}
      {!canEdit && <p className="border bg-secondary px-3 py-2 text-[13px] text-fg-2">{t("page.readOnly")}</p>}
      <LinkCard detail={detail} />
      <ProgressPanel requestId={id} />
      {canEdit && open > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-3 border border-primary/40 bg-secondary px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1 font-semibold">{t("questions.waiting", { count: open })}</span>
          {tab !== "questions" && (
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}?tab=questions`}>{t("questions.answerNow")}</Link>
            </Button>
          )}
        </p>
      )}
      <UnderlineTabs
        label={t("page.tabs")}
        tabs={[
          { label: t("page.tabBrief"), href: base, active: tab === "brief" },
          { label: open > 0 ? t("page.tabQuestionsOpen", { count: open }) : t("page.tabQuestions"), href: `${base}?tab=questions`, active: tab === "questions" },
          { label: t("page.tabFallback"), href: `${base}?tab=fallback`, active: tab === "fallback" },
          { label: t("page.tabPrep"), href: `${base}?tab=prep`, active: tab === "prep" },
          { label: t("page.tabEventDay"), href: `${base}?tab=eventday`, active: tab === "eventday" },
          { label: t("page.tabMessages"), href: `${base}?tab=messages`, active: tab === "messages" },
          { label: t("page.tabOverview"), href: `${base}?tab=overview`, active: tab === "overview" },
        ]}
      />
      {tab === "brief" ? (
        <div className="flex flex-col gap-6">
          {canEdit && BRIEF_EDITABLE.includes(status) ? (
            <BriefEditor key={id} detail={detail} />
          ) : (
            <div className="flex flex-col gap-3">
              {canEdit && <p className="text-[13px] text-fg-2">{t("brief.readOnly")}</p>}
              <div className="border bg-card px-4 py-5 sm:px-6">
                <Markdown>{detail.brief}</Markdown>
              </div>
            </div>
          )}
          <BriefHistory requestId={id} currentVersion={request.briefVersion} />
        </div>
      ) : tab === "questions" ? (
        <QuestionForm requestId={id} canAnswer={canEdit} />
      ) : tab === "fallback" ? (
        <FallbackTab requestId={id} canEdit={canEdit} />
      ) : tab === "prep" ? (
        <PrepTab requestId={id} canEdit={canEdit || canDevelop} />
      ) : tab === "messages" ? (
        <MessagesTab requestId={id} requestStatus={status} canEdit={canEdit} />
      ) : tab === "eventday" ? (
        <EventDayPanel requestId={id} canManageList={canEdit || canDevelop} />
      ) : (
        <div className="flex flex-col gap-6">
          <BannerPanel detail={detail} />
          <Panel title={t("details.title")}>
            <DetailsForm key={request.updatedAt.getTime()} detail={detail} />
          </Panel>
          <HistoryList requestId={id} />
        </div>
      )}
      <CancelDialog requestId={id} open={cancelOpen} onOpenChange={setCancelOpen} />
      {canAccept && (
        <AcceptDialog
          request={{ id, title: request.title, end: request.startsAt ? new Date(request.startsAt.getTime() + (request.durationMinutes ?? 0) * 60_000) : null }}
          open={acceptOpen}
          onOpenChange={setAcceptOpen}
        />
      )}
    </Page>
  );
}
