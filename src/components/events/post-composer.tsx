"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PostCard, type CardKind } from "@/components/events/post-card";
import { PostEntry } from "@/components/events/post-entry";
import { useTRPC } from "@/trpc/client";

/** The kinds the cards write, in due order: team notice (8 days before), announcement (7), reminder (1). */
const KINDS: readonly CardKind[] = ["team", "announcement", "reminder"];

/**
 * The Messages tab: one card each for the team notice, the announcement and the reminder in due order (editor, collapsed Discord preview,
 * actions), then the disaster, resolved and cancelled posts as read-only entries in time order.
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
  const [previewOpen, setPreviewOpen] = useState<Partial<Record<CardKind, boolean>>>({});
  const entries = view.posts.filter((p) => p.kind === "disaster" || p.kind === "resolved" || p.kind === "cancelled");
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {!canEdit && <p className="text-[13px] text-fg-2">{t("readOnly")}</p>}
      <ol aria-label={t("timeline")} className="flex flex-col gap-4">
        {KINDS.map((kind) => (
          <li key={kind} className="min-w-0">
            <PostCard
              key={`${kind}-${view.posts.find((p) => p.kind === kind)?.id ?? "new"}`}
              requestId={requestId}
              kind={kind}
              post={view.posts.find((p) => p.kind === kind)}
              view={view}
              requestStatus={requestStatus}
              canEdit={canEdit}
              previewOpen={previewOpen[kind] ?? false}
              onPreviewOpenChange={(open) => setPreviewOpen((o) => ({ ...o, [kind]: open }))}
            />
          </li>
        ))}
        {entries.map((post) => (
          <li key={post.id} className="min-w-0">
            <PostEntry requestId={requestId} post={post} view={view} latest={entries.findLast((p) => p.kind === post.kind)?.id === post.id} canEdit={canEdit} />
          </li>
        ))}
      </ol>
    </div>
  );
}
