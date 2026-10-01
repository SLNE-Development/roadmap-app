"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { Embed } from "@/lib/discord-limits";
import { buildDisasterEmbed, buildResolvedEmbed } from "@/lib/event-messages";
import { useTRPC } from "@/trpc/client";

const MAX_NOTE = 1500;

/** A card as Discord shows it: the colour bar, title, text and image. */
function EmbedPreview({ embed, label }: { embed: Embed; label: string }) {
  return (
    <figure aria-label={label} className="flex flex-col gap-1.5 border-l-4 bg-secondary px-4 py-3 text-[13px]" style={{ borderLeftColor: embed.color }}>
      {embed.title && <p className="font-semibold">{embed.title}</p>}
      <p className="whitespace-pre-wrap">{embed.description}</p>
      {embed.imageUploadId && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the access-checked upload route
        <img src={`/api/uploads/${embed.imageUploadId}`} alt="" className="max-h-40 max-w-full object-contain" />
      )}
    </figure>
  );
}

/**
 * The disaster panel of the event-day views: post the disaster message (with a confirmation that shows the card and says no
 * ping is sent), and while one is posted resolve it with an optional note. A send that stalled can be resumed like any post.
 *
 * @param props.requestId the request
 */
export function DisasterPanel({ requestId }: { requestId: string }) {
  const t = useTranslations("events.disaster");
  const trpc = useTRPC();
  const id = useId();
  const [postOpen, setPostOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [postNote, setPostNote] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const { data: view } = useQuery({
    ...trpc.requests.posts.disasterState.queryOptions({ id: requestId }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const data = query.state.data;
      return [data?.post?.status, data?.resolved?.status].some((status) => status === "sending" || status === "partial") ? 3000 : false;
    },
  });
  const post = useMutation(trpc.requests.posts.disaster.mutationOptions({ onSuccess: () => toast.success(t("posted")) }));
  const resolve = useMutation(trpc.requests.posts.resolve.mutationOptions({ onSuccess: () => toast.success(t("resolving")) }));
  const remove = useMutation(trpc.requests.posts.delete.mutationOptions({ onSuccess: () => toast.success(t("deleting")) }));
  const resume = useMutation(trpc.requests.posts.resume.mutationOptions({ onSuccess: () => toast.success(t("resumed")) }));
  if (!view) return <div aria-hidden className="h-5 w-48 animate-pulse rounded bg-secondary" />;
  const live = view.post;
  const open = live !== null && live.resolvedAt === null && ["sending", "partial", "posted"].includes(live.status);
  const resolved = view.resolved;
  const resolvedStalled = resolved !== null && (resolved.status === "partial" || resolved.status === "failed" || resolved.stale);
  const resolvedDeletable = resolved !== null && resolved.sentCount > 0 && (["posted", "partial", "failed"].includes(resolved.status) || resolved.stale);
  const settings = { timeZone: view.timeZone, rulebookUrl: view.rulebookUrl, disasterTemplate: { ...view.template.disaster, imageUploadId: view.template.imageUploadId }, resolvedTemplate: view.template.resolved };
  const stalled = live !== null && (live.status === "partial" || live.status === "failed" || live.stale);
  let reason: string | null = null;
  if (!view.canAct) reason = t("reasonRights");
  else if (!view.hookSet) reason = t("reasonWebhook");
  const busy = post.isPending || resolve.isPending || resume.isPending || remove.isPending;
  const deletable = live !== null && live.sentCount > 0 && (["posted", "partial", "failed"].includes(live.status) || live.stale);
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-title`} className="font-semibold">
          {t("title")}
        </h3>
        {live && <Badge variant={live.status === "partial" || live.status === "failed" ? "destructive" : "outline"}>{live.resolvedAt ? t("statusResolved") : t(`status.${live.status}`)}</Badge>}
        {live && live.status !== "posted" && live.partsCount > 0 && <span className="text-[12.5px] text-muted-foreground">{t("sentOf", { sent: live.sentCount, total: live.partsCount })}</span>}
      </div>
      {live?.lastError && (
        <p role="alert" className="text-[13px] text-destructive">
          {live.lastError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!open && (
          <Button type="button" variant="destructive" disabled={busy || reason !== null} aria-describedby={reason ? `${id}-reason` : undefined} onClick={() => setPostOpen(true)}>
            {t("post")}
          </Button>
        )}
        {open && live.status === "posted" && (
          <Button type="button" disabled={busy || !view.canAct} aria-describedby={!view.canAct ? `${id}-reason` : undefined} onClick={() => setResolveOpen(true)}>
            {t("resolve")}
          </Button>
        )}
        {stalled && view.canAct && (
          <Button type="button" disabled={busy} onClick={() => resume.mutate({ id: requestId, kind: "disaster" })}>
            {t("resume")}
          </Button>
        )}
        {deletable && view.canAct && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOpen(true)}>
            {t("delete")}
          </Button>
        )}
      </div>
      {reason && (
        <p id={`${id}-reason`} className="text-[12.5px] text-muted-foreground">
          {reason}
        </p>
      )}
      {resolved && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px]">{t("resolvedMessage")}</span>
          <Badge variant={resolved.status === "partial" || resolved.status === "failed" ? "destructive" : "outline"}>{t(`status.${resolved.status}`)}</Badge>
          {resolved.status !== "posted" && resolved.partsCount > 0 && <span className="text-[12.5px] text-muted-foreground">{t("sentOf", { sent: resolved.sentCount, total: resolved.partsCount })}</span>}
          {resolvedStalled && view.canAct && (
            <Button type="button" size="sm" disabled={busy} onClick={() => resume.mutate({ id: requestId, kind: "resolved" })}>
              {t("resume")}
            </Button>
          )}
          {resolvedDeletable && view.canAct && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => remove.mutate({ id: requestId, kind: "resolved" })}>
              {t("delete")}
            </Button>
          )}
        </div>
      )}
      {resolved?.lastError && (
        <p role="alert" className="text-[13px] text-destructive">
          {resolved.lastError}
        </p>
      )}
      <p className="text-[12.5px] text-muted-foreground">{t("noPing")}</p>

      <Dialog open={postOpen} onOpenChange={setPostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("postTitle")}</DialogTitle>
            <DialogDescription>
              {t("postBody")} {t("noPing")}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-post-note`}>{t("note")}</FieldLabel>
            <Textarea id={`${id}-post-note`} value={postNote} maxLength={MAX_NOTE} className="min-h-20" onChange={(e) => setPostNote(e.target.value)} />
            <p className="text-[12.5px] text-muted-foreground">{t("noteHelp", { max: MAX_NOTE })}</p>
          </Field>
          <EmbedPreview embed={buildDisasterEmbed(view.request, settings, postNote.trim() === "" ? null : postNote.trim())} label={t("previewDisaster")} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={post.isPending}
              onClick={() => {
                setPostOpen(false);
                post.mutate({ id: requestId, note: postNote.trim() === "" ? undefined : postNote });
                setPostNote("");
              }}
            >
              {t("post")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                setDeleteOpen(false);
                remove.mutate({ id: requestId, kind: "disaster" });
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("resolveTitle")}</DialogTitle>
            <DialogDescription>
              {t("resolveBody")} {t("noPing")}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-note`}>{t("note")}</FieldLabel>
            <Textarea id={`${id}-note`} value={resolveNote} maxLength={MAX_NOTE} className="min-h-20" onChange={(e) => setResolveNote(e.target.value)} />
            <p className="text-[12.5px] text-muted-foreground">{t("noteHelp", { max: MAX_NOTE })}</p>
          </Field>
          <EmbedPreview embed={buildResolvedEmbed(view.request, settings, resolveNote.trim() === "" ? null : resolveNote.trim())} label={t("previewResolved")} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={resolve.isPending}
              onClick={() => {
                setResolveOpen(false);
                resolve.mutate({ id: requestId, note: resolveNote.trim() === "" ? undefined : resolveNote });
                setResolveNote("");
              }}
            >
              {t("resolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
