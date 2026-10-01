"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { DiscordPreview } from "@/components/events/discord-preview";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Panel } from "@/components/page";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import type { Embed } from "@/lib/discord-limits";
import { buildDisasterEmbed, buildResolvedEmbed } from "@/lib/event-messages";
import { useTRPC } from "@/trpc/client";

const MAX_NOTE = 1500;

/** The badge variant of a post status: trouble is red, everything else is quiet. */
const statusVariant = (status: string) => (status === "partial" || status === "failed" ? "destructive" : "outline");

/**
 * A dialog with a compact Markdown note editor and the live Discord preview of the message the note goes into. The note lives
 * here, not in a query key, so typing never refetches or unmounts anything.
 *
 * @param props.build the embed the note produces, filled on the client
 * @param props.onConfirm called with the trimmed note, or undefined when it is empty, after the dialog closed
 */
function NoteDialog({
  open,
  onOpenChange,
  title,
  body,
  confirm,
  destructive,
  pending,
  build,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirm: string;
  destructive?: boolean;
  pending: boolean;
  build: (note: string | null) => Embed;
  onConfirm: (note: string | undefined) => void;
}) {
  const t = useTranslations("events.disaster");
  const trpc = useTRPC();
  const locale = useLocale();
  const id = useId();
  const [note, setNote] = useState("");
  const settings = useQuery({ ...trpc.requests.settings.get.queryOptions(), enabled: open });
  const trimmed = note.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-[19px] font-semibold">{title}</DialogTitle>
          <DialogDescription>
            {body} {t("noPing")}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={id}>{t("note")}</FieldLabel>
          <MarkdownEditor id={id} variant="compact" value={note} onChange={setNote} maxLength={MAX_NOTE} minRows={4} />
          <FieldDescription>{t("noteHelp", { max: MAX_NOTE })}</FieldDescription>
        </Field>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium">{t("preview")}</span>
          <DiscordPreview parts={[{ kind: "embed", content: "", embed: build(trimmed === "" ? null : trimmed) }]} postAs={settings.data?.postAs ?? "Events"} avatarUrl={settings.data?.postAvatarUrl} locale={locale} timeZone={settings.data?.timeZone ?? "UTC"} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
              onConfirm(trimmed === "" ? undefined : trimmed);
              setNote("");
            }}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One message of the panel: its name, status, how far the send got, the last error and its actions. */
function MessageRow({
  name,
  status,
  badge,
  sent,
  error,
  children,
}: {
  name: string;
  status: string;
  badge: string;
  sent: { sent: number; total: number } | null;
  error: string | null;
  children?: React.ReactNode;
}) {
  const t = useTranslations("events.disaster");
  return (
    <div className="flex flex-col gap-2 border bg-secondary/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold">{name}</span>
        <Badge variant={statusVariant(status)}>{badge}</Badge>
        {sent && <span className="text-[12.5px] text-muted-foreground">{t("sentOf", sent)}</span>}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * The disaster panel of the event-day views: post the disaster message with a note (dialog with a live preview), resolve it
 * with another note (a message of its own), and resume or delete a post that stalled. The panel keeps showing the last state while
 * the query refetches, so nothing unmounts while someone types in a dialog.
 *
 * @param props.requestId the request
 */
export function DisasterPanel({ requestId }: { requestId: string }) {
  const t = useTranslations("events.disaster");
  const trpc = useTRPC();
  const id = useId();
  const [postOpen, setPostOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [deleting, setDeleting] = useState<"disaster" | "resolved" | null>(null);
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
  if (!view) return <div aria-hidden className="h-40 animate-pulse bg-secondary" />;
  const live = view.post;
  const open = live !== null && live.resolvedAt === null && ["sending", "partial", "posted"].includes(live.status);
  const resolved = view.resolved;
  const stalled = (p: { status: string; stale: boolean }) => p.status === "partial" || p.status === "failed" || p.stale;
  const deletable = (p: { status: string; sentCount: number; stale: boolean }) => p.sentCount > 0 && (["posted", "partial", "failed"].includes(p.status) || p.stale);
  const settings = { timeZone: view.timeZone, rulebookUrl: view.rulebookUrl, disasterTemplate: { ...view.template.disaster, imageUploadId: view.template.imageUploadId }, resolvedTemplate: view.template.resolved };
  let reason: string | null = null;
  if (!view.canAct) reason = t("reasonRights");
  else if (!view.hookSet) reason = t("reasonWebhook");
  const busy = post.isPending || resolve.isPending || resume.isPending || remove.isPending;
  const progress = (p: { status: string; partsCount: number; sentCount: number }) => (p.status !== "posted" && p.partsCount > 0 ? { sent: p.sentCount, total: p.partsCount } : null);
  return (
    <Panel
      title={t("panelTitle")}
      action={
        !open ? (
          <Button type="button" size="sm" variant="destructive" disabled={busy || reason !== null} aria-describedby={reason ? `${id}-reason` : undefined} onClick={() => setPostOpen(true)}>
            {t("post")}
          </Button>
        ) : undefined
      }
      bodyClassName="gap-3 px-4 pb-4 sm:px-5"
    >
      {!live && !resolved && <p className="text-[13px] text-fg-2">{t("idle")}</p>}
      {live && (
        <MessageRow name={t("title")} status={live.status} badge={live.resolvedAt ? t("statusResolved") : t(`status.${live.status}`)} sent={progress(live)} error={live.lastError}>
          {open && live.status === "posted" && (
            <Button type="button" size="sm" disabled={busy || !view.canAct} aria-describedby={!view.canAct ? `${id}-reason` : undefined} onClick={() => setResolveOpen(true)}>
              {t("resolve")}
            </Button>
          )}
          {stalled(live) && view.canAct && (
            <Button type="button" size="sm" disabled={busy} onClick={() => resume.mutate({ id: requestId, kind: "disaster" })}>
              {t("resume")}
            </Button>
          )}
          {deletable(live) && view.canAct && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDeleting("disaster")}>
              {t("delete")}
            </Button>
          )}
        </MessageRow>
      )}
      {resolved && (
        <MessageRow name={t("resolvedMessage")} status={resolved.status} badge={t(`status.${resolved.status}`)} sent={progress(resolved)} error={resolved.lastError}>
          {stalled(resolved) && view.canAct && (
            <Button type="button" size="sm" disabled={busy} onClick={() => resume.mutate({ id: requestId, kind: "resolved" })}>
              {t("resume")}
            </Button>
          )}
          {deletable(resolved) && view.canAct && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDeleting("resolved")}>
              {t("delete")}
            </Button>
          )}
        </MessageRow>
      )}
      {reason && (
        <p id={`${id}-reason`} className="text-[12.5px] text-muted-foreground">
          {reason}
        </p>
      )}
      <p className="text-[12.5px] text-muted-foreground">{t("noPing")}</p>

      <NoteDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title={t("postTitle")}
        body={t("postBody")}
        confirm={t("post")}
        destructive
        pending={post.isPending}
        build={(note) => buildDisasterEmbed(view.request, settings, note)}
        onConfirm={(note) => post.mutate({ id: requestId, note })}
      />
      <NoteDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title={t("resolveTitle")}
        body={t("resolveBody")}
        confirm={t("resolve")}
        pending={resolve.isPending}
        build={(note) => buildResolvedEmbed(view.request, settings, note)}
        onConfirm={(note) => resolve.mutate({ id: requestId, note })}
      />
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting === "resolved" ? t("deleteResolvedTitle") : t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{deleting === "resolved" ? t("deleteResolvedBody") : t("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && remove.mutate({ id: requestId, kind: deleting })}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
