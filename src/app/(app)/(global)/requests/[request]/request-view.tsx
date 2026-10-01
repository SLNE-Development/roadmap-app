"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { UnderlineTabs } from "@/components/activity/url-tabs";
import { BriefTab } from "@/components/events/brief-tab";
import { EventDayPanel } from "@/components/events/event-day-panel";
import { FallbackTab } from "@/components/events/fallback-tab";
import { MessagesTab } from "@/components/events/post-composer";
import { PrepTab } from "@/components/events/prep-tab";
import { openCount, QuestionForm } from "@/components/events/question-form";
import { RequestHeader } from "@/components/events/request-header";
import { RequestOverview } from "@/components/events/request-overview";
import { Page } from "@/components/page";
import type { RequestStatus } from "@/lib/event-status";
import { useTRPC } from "@/trpc/client";

/** The statuses in which the brief is edited. */
const BRIEF_EDITABLE: readonly RequestStatus[] = ["draft", "submitted", "accepted", "event_week"];

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
        <BriefTab detail={detail} editable={BRIEF_EDITABLE.includes(status)} />
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
