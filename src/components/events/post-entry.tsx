"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { DeleteDialog, PostPreview, STATUS_VARIANT, usePostActions } from "@/components/events/post-card";
import { Panel } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { POST_TARGET } from "@/lib/event-messages";
import type { PostsView, PostView } from "@/lib/ops/request-posts";

/**
 * A disaster, resolved or cancelled post on the timeline: read-only, with its status, who posted it and when, the note and
 * the Discord preview of the message. Resume and Delete appear where the post allows them. The text of these posts is
 * never edited here and a deleted one leaves no draft behind.
 *
 * @param props.requestId the request
 * @param props.post the saved post
 * @param props.view the posts view, for the webhook state
 * @param props.latest whether this is the newest post of its kind, the one the preview shows
 * @param props.canEdit whether the actor may resume and delete
 */
export function PostEntry({ requestId, post, view, latest, canEdit }: { requestId: string; post: PostView; view: PostsView; latest: boolean; canEdit: boolean }) {
  const t = useTranslations("events.messages");
  const format = useFormatter();
  const kind = post.kind as "disaster" | "resolved" | "cancelled";
  const { resume, remove, busy } = usePostActions(requestId, kind);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const hasSent = post.sentCount > 0;
  const target = POST_TARGET[kind];
  const canResume = post.status === "partial" || post.stale || (post.status === "failed" && hasSent);
  const canDelete = (post.status === "posted" || post.status === "partial" || post.status === "failed" || post.stale) && hasSent;
  const noWebhook = !view.targets[target];
  return (
    <Panel
      title={t(`kind.${kind}`)}
      action={
        <>
          <Badge variant={STATUS_VARIANT[post.status]}>{t(`status.${post.status}`)}</Badge>
          {post.status === "posted" && post.postedAt && <span className="text-[12.5px] text-muted-foreground">{format.dateTime(post.postedAt, { dateStyle: "medium", timeStyle: "short" })}</span>}
        </>
      }
      bodyClassName="gap-3 px-4 pb-4 sm:px-5"
    >
      {post.note && (
        <p className="text-[13.5px]">
          <span className="font-medium">{t("entryNote")}: </span>
          {post.note}
        </p>
      )}
      {post.status === "posted" && post.postedByName && <p className="text-[13px] text-fg-2">{t("postedBy", { date: format.dateTime(post.postedAt ?? new Date(), { dateStyle: "medium", timeStyle: "short" }), name: post.postedByName })}</p>}
      {post.partsCount > 0 && post.status !== "posted" && <p className="text-[12.5px] text-muted-foreground">{t("sentOf", { sent: post.sentCount, total: post.partsCount })}</p>}
      {post.lastError && (
        <p role="alert" className="text-[13px] text-destructive">
          {post.lastError}
        </p>
      )}
      {latest && <PostPreview requestId={requestId} kind={kind} dirty={false} />}
      {canEdit && (canResume || canDelete) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {canResume && (
              <Button type="button" disabled={busy || noWebhook} onClick={() => resume.mutate({ id: requestId, kind })}>
                {t("resume")}
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOpen(true)}>
                {t("delete")}
              </Button>
            )}
          </div>
          {canResume && noWebhook && <p className="text-[12.5px] text-muted-foreground">{t("reasonWebhook", { target: t(`target.${target}`) })}</p>}
        </div>
      )}
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={post.sentCount}
        target={target}
        keepsText={false}
        pending={remove.isPending}
        onConfirm={() => {
          setDeleteOpen(false);
          remove.mutate({ id: requestId, kind });
        }}
      />
    </Panel>
  );
}
