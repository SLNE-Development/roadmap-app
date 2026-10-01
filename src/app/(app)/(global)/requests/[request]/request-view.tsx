"use client";

import { useMutation, useQueryClient, useSuspenseQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { UnderlineTabs } from "@/components/activity/url-tabs";
import { BriefHistory } from "@/components/events/brief-history";
import { EventDayPanel } from "@/components/events/event-day-panel";
import { FallbackTab } from "@/components/events/fallback-tab";
import { MessagesTab } from "@/components/events/post-composer";
import { PrepTab } from "@/components/events/prep-tab";
import { openCount, QuestionForm } from "@/components/events/question-form";
import { RequestHeader } from "@/components/events/request-header";
import { RequestOverview } from "@/components/events/request-overview";
import { Markdown } from "@/components/markdown";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RequestStatus } from "@/lib/event-status";
import type { RequestDetail } from "@/lib/ops/requests";
import { useTRPC } from "@/trpc/client";

/** The statuses in which the brief is edited. */
const BRIEF_EDITABLE: readonly RequestStatus[] = ["draft", "submitted", "accepted", "event_week"];

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

/**
 * The page of one event request: the header with its primary step and More menu, the lifecycle stepper, the tabs and the
 * current tab's content. A request the actor can only view renders read-only.
 *
 * @param props.id the request id
 * @param props.tab the tab shown
 */
export function RequestView({ id, tab }: { id: string; tab: "overview" | "brief" | "questions" | "fallback" | "prep" | "eventday" | "messages" }) {
  const t = useTranslations("events");
  const trpc = useTRPC();
  const [{ data: detail }, { data: rounds }, { data: fallbacks }] = useSuspenseQueries({
    queries: [trpc.requests.get.queryOptions({ id }), trpc.requests.rounds.queryOptions({ id }), trpc.requests.fallbacks.queryOptions({ id })],
  });
  const { request, canEdit, canDevelop } = detail;
  const { status } = request;
  const incomplete = fallbacks.filter((f) => f.required && (!f.whatWeDo.trim() || !f.whoDecides.trim())).map((f) => f.title);
  const open = openCount(rounds);
  const base = `/requests/${id}`;

  return (
    <Page>
      <RequestHeader detail={detail} incomplete={incomplete} tab={tab} />
      <UnderlineTabs
        label={t("page.tabs")}
        tabs={[
          { label: t("page.tabOverview"), href: base, active: tab === "overview" },
          { label: t("page.tabBrief"), href: `${base}?tab=brief`, active: tab === "brief" },
          { label: open > 0 ? t("page.tabQuestionsOpen", { count: open }) : t("page.tabQuestions"), href: `${base}?tab=questions`, active: tab === "questions" },
          { label: t("page.tabFallback"), href: `${base}?tab=fallback`, active: tab === "fallback" },
          { label: t("page.tabPrep"), href: `${base}?tab=prep`, active: tab === "prep" },
          { label: t("page.tabMessages"), href: `${base}?tab=messages`, active: tab === "messages" },
          { label: t("page.tabEventDay"), href: `${base}?tab=eventday`, active: tab === "eventday" },
        ]}
      />
      {tab === "overview" ? (
        <RequestOverview key={id} detail={detail} />
      ) : tab === "brief" ? (
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
      ) : (
        <EventDayPanel requestId={id} canManageList={canEdit || canDevelop} />
      )}
    </Page>
  );
}
