"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { PostCard, type CardKind } from "@/components/events/post-card";
import { PostEntry } from "@/components/events/post-entry";
import { useTRPC } from "@/trpc/client";

/** The kinds the timeline writes, in due order: team notice (8 days before), announcement (7), reminder (1). */
const KINDS: readonly CardKind[] = ["team", "announcement", "reminder"];

/**
 * One step of the timeline: the date on the rail, the dot on the line and the card beside it.
 *
 * @param props.date the due or posted date, if there is one
 * @param props.tone the dot colour: done (posted), late or plain
 */
function TimelineItem({ date, tone, children }: { date: Date | null; tone: "done" | "late" | "plain"; children: React.ReactNode }) {
  const t = useTranslations("events.messages");
  const format = useFormatter();
  const dot = tone === "done" ? "bg-primary" : tone === "late" ? "bg-destructive" : "bg-border";
  return (
    <li className="flex flex-col gap-2 pb-6 last:pb-0 sm:flex-row sm:gap-0">
      <div className="flex shrink-0 items-baseline gap-2 sm:w-24 sm:flex-col sm:items-end sm:gap-0 sm:pr-5 sm:pt-4 sm:text-right">
        {date ? (
          <>
            <span className="font-display text-[19px] leading-none font-semibold tabular-nums">{format.dateTime(date, { day: "numeric" })}</span>
            <span className="text-[12px] text-muted-foreground">{format.dateTime(date, { month: "short" })}</span>
          </>
        ) : (
          <span className="text-[12px] text-muted-foreground">{t("noDue")}</span>
        )}
      </div>
      <div className="relative min-w-0 flex-1 sm:border-l sm:pl-5">
        <span aria-hidden className={`absolute top-[21px] -left-[5px] hidden size-[9px] rounded-full ring-4 ring-background sm:block ${dot}`} />
        {children}
      </div>
    </li>
  );
}

/**
 * The Messages tab: a timeline of the team notice, the announcement and the reminder in due order, each a card with the
 * editor, the preview and the actions, then the disaster, resolved and cancelled posts as read-only entries in time order.
 * While a post is being sent the list refreshes every few seconds so its progress shows.
 *
 * @param props.requestId the request
 * @param props.requestStatus the request's status, which decides whether posting is allowed
 * @param props.canEdit whether the actor may change and post
 */
export function MessagesTab({ requestId, requestStatus, canEdit }: { requestId: string; requestStatus: string; canEdit: boolean }) {
  const t = useTranslations("events.messages");
  const trpc = useTRPC();
  const { data: view } = useSuspenseQuery({
    ...trpc.requests.posts.list.queryOptions({ id: requestId }),
    refetchInterval: (query) => (query.state.data?.posts.some((p) => p.status === "sending" || p.status === "partial") ? 3000 : false),
  });
  const entries = view.posts.filter((p) => p.kind === "disaster" || p.kind === "resolved" || p.kind === "cancelled");
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {!canEdit && <p className="text-[13px] text-fg-2">{t("readOnly")}</p>}
      <ol aria-label={t("timeline")} className="flex flex-col">
        {KINDS.map((kind) => {
          const post = view.posts.find((p) => p.kind === kind);
          const due = view.dues[kind];
          return (
            <TimelineItem key={`${kind}-${post?.id ?? "new"}`} date={due.dueAt} tone={post?.status === "posted" ? "done" : due.late ? "late" : "plain"}>
              <PostCard requestId={requestId} kind={kind} post={post} view={view} requestStatus={requestStatus} canEdit={canEdit} />
            </TimelineItem>
          );
        })}
        {entries.map((post) => (
          <TimelineItem key={post.id} date={post.postedAt} tone={post.status === "posted" ? "done" : "plain"}>
            <PostEntry requestId={requestId} post={post} view={view} latest={entries.findLast((p) => p.kind === post.kind)?.id === post.id} canEdit={canEdit} />
          </TimelineItem>
        ))}
      </ol>
    </div>
  );
}
