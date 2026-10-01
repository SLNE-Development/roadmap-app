"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useFormatter, useLocale, useTimeZone, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { DiscordPreview } from "@/components/events/discord-preview";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Panel } from "@/components/page";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { MAX_POST_TEXT, POST_TARGET, type PostKind } from "@/lib/event-messages";
import { VISIBLE_PLACEHOLDERS } from "@/lib/event-placeholders";
import type { PostsView, PostView } from "@/lib/ops/request-posts";
import { useTRPC } from "@/trpc/client";

/** The kinds the timeline cards write; disaster, resolved and cancelled posts are read-only entries. */
export type CardKind = "team" | "announcement" | "reminder";

/** Statuses in which the text can no longer be edited as a draft; a posted or partial post is changed through Edit. */
const LOCKED = ["sending", "partial", "posted"];

/** How long the card waits for the result of a test send before it gives up. */
const TEST_WAIT_MS = 60_000;

/** The badge colour of each status. */
export const STATUS_VARIANT = { draft: "outline", sending: "secondary", partial: "destructive", posted: "default", failed: "destructive", deleted: "outline" } as const;

/**
 * The Discord-style preview of a post, in a collapsible that is closed by default: the planned messages with rendered
 * Markdown, timestamps in the viewer's zone and the embed card. With `text` it plans from what the editor holds, shortly
 * after typing stops, and keeps the last preview on screen while the next one loads.
 *
 * @param props.requestId the request
 * @param props.kind the kind of post
 * @param props.text the editor text to preview; omitted, the saved post is previewed
 * @param props.pingRole whether the preview mentions the ping role; omitted, the saved post's value
 * @param props.open the open state when the parent keeps it, so a remount of the card does not close it
 * @param props.onOpenChange called when the person opens or closes it
 */
export function PostPreview({ requestId, kind, text, pingRole, open, onOpenChange }: { requestId: string; kind: PostKind; text?: string; pingRole?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const t = useTranslations("events.messages");
  const trpc = useTRPC();
  const locale = useLocale();
  const zone = useTimeZone() ?? "UTC";
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  const settled = useDebouncedValue(text, 400);
  const preview = useQuery({ ...trpc.requests.posts.preview.queryOptions({ id: requestId, kind, ...(settled === undefined ? {} : { text: settled }), ...(pingRole === undefined ? {} : { pingRole }) }), placeholderData: keepPreviousData });
  const settings = useQuery({ ...trpc.requests.settings.get.queryOptions(), retry: false });
  const parts = preview.data?.parts ?? [];
  return (
    <Collapsible
      open={shown}
      onOpenChange={(next) => {
        setOwn(next);
        onOpenChange?.(next);
      }}
      className="flex min-w-0 flex-col gap-2"
    >
      <CollapsibleTrigger className="group flex items-center gap-2 self-start text-[13px] font-semibold">
        <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        {t("previewTitle")}
        {parts.length > 0 && <span className="font-normal text-muted-foreground">{t("previewCount", { count: parts.length })}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {preview.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {preview.error.message}
          </p>
        ) : parts.length > 0 ? (
          <DiscordPreview parts={parts.map((p) => ({ kind: p.kind, content: p.content, embed: p.embed }))} postAs={settings.data?.postAs ?? "Events"} avatarUrl={settings.data?.postAvatarUrl} locale={locale} timeZone={settings.data?.timeZone ?? zone} />
        ) : (
          <p className="border border-dashed px-4 py-3 text-[13px] text-muted-foreground">{t("previewEmpty")}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The mutations and the test-send wait shared by the card and the read-only entries. */
export function usePostActions(requestId: string, kind: PostKind) {
  const t = useTranslations("events.messages");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const save = useMutation(trpc.requests.posts.saveDraft.mutationOptions({ onSuccess: () => toast.success(t("saved")) }));
  const start = useMutation(trpc.requests.posts.start.mutationOptions({ onSuccess: () => toast.success(t("started")) }));
  const resume = useMutation(trpc.requests.posts.resume.mutationOptions({ onSuccess: () => toast.success(t("resumed")) }));
  const edit = useMutation(trpc.requests.posts.edit.mutationOptions({ onSuccess: () => toast.success(t("edited")) }));
  const remove = useMutation(trpc.requests.posts.delete.mutationOptions({ onSuccess: () => toast.success(t("deleting")) }));
  const testSend = useMutation(trpc.requests.posts.testSend.mutationOptions());
  const sendTest = () =>
    testSend.mutate(
      { id: requestId, kind },
      {
        onSuccess: async () => {
          const since = Date.now();
          setTesting(true);
          try {
            while (Date.now() - since < TEST_WAIT_MS) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              const result = await queryClient.fetchQuery({ ...trpc.requests.posts.testResult.queryOptions({ id: requestId, kind }), staleTime: 0 });
              if (result && new Date(result.at).getTime() >= since - 2000) {
                if (result.ok) toast.success(t("testOk", { count: result.count }));
                else toast.error(t("testFailed", { error: result.error }));
                return;
              }
            }
            toast.error(t("testTimeout"));
          } finally {
            setTesting(false);
          }
        },
      },
    );
  const busy = save.isPending || start.isPending || resume.isPending || edit.isPending || remove.isPending;
  return { save, start, resume, edit, remove, testSend, sendTest, testing, busy };
}

/** The confirmation of deleting the Discord messages of a post; `keepsText` adds that the text stays as a new draft. */
export function DeleteDialog({ open, onOpenChange, count, target, keepsText, pending, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; count: number; target: "team" | "public"; keepsText: boolean; pending: boolean; onConfirm: () => void }) {
  const t = useTranslations("events.messages");
  const tc = useTranslations("common");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t(keepsText ? "deleteBody" : "deleteBodyEntry", { count, target: t(`target.${target}`) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * One card of the timeline: the Markdown editor with placeholder chips, the ping switch, the status, the Discord preview of
 * the saved post and the buttons. The card is keyed by kind and post id only; it keeps what is typed until the post
 * changes on the server and the text is not being edited, so a refetch never costs a keystroke. A button is disabled with
 * its reason shown, and the "save first" hint shows once above the buttons.
 *
 * @param props.requestId the request
 * @param props.kind the kind of post
 * @param props.post the saved post, if any
 * @param props.view the posts view the card belongs to
 * @param props.requestStatus the request's status
 * @param props.canEdit whether the actor may change and post
 * @param props.previewOpen whether the Discord preview is open; the tab keeps it, so saving the first draft does not close it
 * @param props.onPreviewOpenChange called when the preview is opened or closed
 */
export function PostCard({ requestId, kind, post, view, requestStatus, canEdit, previewOpen, onPreviewOpenChange }: { requestId: string; kind: CardKind; post: PostView | undefined; view: PostsView; requestStatus: string; canEdit: boolean; previewOpen: boolean; onPreviewOpenChange: (open: boolean) => void }) {
  const t = useTranslations("events.messages");
  const tc = useTranslations("events.card");
  const format = useFormatter();
  const id = useId();
  const serverText = post?.text ?? "";
  const serverPing = post?.pingRole ?? false;
  const serverAt = post?.updatedAt ? new Date(post.updatedAt).getTime() : 0;
  const [text, setText] = useState(serverText);
  const [pingRole, setPingRole] = useState(serverPing);
  // The server state this card last took over; text typed since then is unsaved.
  const [seen, setSeen] = useState({ at: serverAt, text: serverText, ping: serverPing });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { save, start, resume, edit, remove, testSend, sendTest, testing, busy } = usePostActions(requestId, kind);
  if (seen.at !== serverAt) {
    // The post changed on the server: take it over unless the person has typed something that was not saved.
    if (text === seen.text && pingRole === seen.ping) {
      setText(serverText);
      setPingRole(serverPing);
    }
    setSeen({ at: serverAt, text: serverText, ping: serverPing });
  }
  const target = POST_TARGET[kind];
  const status = post?.status ?? "draft";
  const editable = canEdit && (!LOCKED.includes(status) || editing);
  const hasSent = (post?.sentCount ?? 0) > 0;
  // A `sending` post whose job is lost can be resumed or deleted like a partial one.
  const stale = post?.stale === true;
  const dirty = text !== serverText || (kind !== "team" && !editing && pingRole !== serverPing);
  const due = view.dues[kind];
  const canPing = kind !== "team";

  let reason: string | null = null;
  if (!view.targets[target]) reason = t("reasonWebhook", { target: t(`target.${target}`) });
  else if (requestStatus !== "accepted" && requestStatus !== "event_week") reason = t("reasonStatus");
  else if (!post || post.text.trim() === "") reason = t("reasonEmpty");
  const postBlocked = reason !== null || dirty;
  const testBlocked = !view.targets.staff || !post || post.text.trim() === "" || dirty;

  /** Puts the placeholder at the caret of the editor's textarea; the textarea keeps its own undo history. */
  const insert = (token: string) => {
    const el = document.getElementById(`${id}-text`) as HTMLTextAreaElement | null;
    const from = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? text.length;
    el?.focus();
    el?.setSelectionRange(from, to);
    if (el && typeof document.execCommand === "function" && document.execCommand("insertText", false, token) && el.value !== text) return;
    setText(text.slice(0, from) + token + text.slice(to));
    requestAnimationFrame(() => el?.setSelectionRange(from + token.length, from + token.length));
  };
  const chips = (
    <div role="group" aria-label={t("placeholders")} className="flex flex-wrap gap-0.5">
      {VISIBLE_PLACEHOLDERS.map((name) => (
        <Button key={name} type="button" size="xs" variant="ghost" className="font-mono" disabled={!editable} aria-label={t("insert", { name })} onClick={() => insert(`{${name}}`)}>
          {`{${name}}`}
        </Button>
      ))}
    </div>
  );

  return (
    <Panel
      title={t(`kind.${kind}`)}
      action={
        <>
          <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
          {due.dueAt && status !== "posted" && (
            <Badge variant={due.late ? "destructive" : "outline"}>
              {due.late ? `${t("late")}: ` : ""}
              {t("due", { date: format.dateTime(due.dueAt, { day: "numeric", month: "short" }) })}
            </Badge>
          )}
        </>
      }
      bodyClassName="gap-4 px-4 pb-4 sm:px-5"
    >
      <Field>
        <FieldLabel htmlFor={`${id}-text`} className="sr-only">
          {t("editor")}
        </FieldLabel>
        <MarkdownEditor id={`${id}-text`} value={text} onChange={setText} maxLength={MAX_POST_TEXT} minRows={8} disabled={!editable} extraTools={chips} />
      </Field>
      {canPing && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-[13.5px]">
            <Switch checked={pingRole} disabled={!editable || editing || !view.pingRoleSet} onCheckedChange={setPingRole} />
            {t("ping")}
          </label>
          {!view.pingRoleSet && <p className="text-[12.5px] text-muted-foreground">{t("pingUnset")}</p>}
        </div>
      )}
      <PostPreview requestId={requestId} kind={kind} text={text} {...(canPing ? { pingRole: editing ? serverPing : pingRole } : {})} open={previewOpen} onOpenChange={onPreviewOpenChange} />
      {post && post.partsCount > 0 && status !== "posted" && (
        <p className="text-[12.5px] text-muted-foreground">{t("sentOf", { sent: post.sentCount, total: post.partsCount })}</p>
      )}
      {status === "posted" && post?.postedAt && (
        <p className="text-[13px] text-fg-2">{t("postedBy", { date: format.dateTime(post.postedAt, { dateStyle: "medium", timeStyle: "short" }), name: post.postedByName ?? "?" })}</p>
      )}
      {post?.lastError && (
        <p role="alert" className="text-[13px] text-destructive">
          {post.lastError}
        </p>
      )}
      {(status === "sending" || status === "partial") && <p className="text-[12.5px] text-muted-foreground">{t("stall")}</p>}
      {canEdit && editing && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-fg-2">{t("editNote", { count: post?.partsCount ?? 0 })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || !dirty}
              onClick={() => {
                setEditing(false);
                edit.mutate({ id: requestId, kind, text });
              }}
            >
              {t("saveEdit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setText(serverText);
                setEditing(false);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {canEdit && !editing && (
        <div className="flex flex-col gap-2">
          {dirty && (
            <p role="status" className="text-[13px] font-medium text-fg-2">
              {t("reasonDirty")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={dirty ? "default" : "outline"} disabled={busy || !editable || !dirty} onClick={() => save.mutate({ id: requestId, kind, text, ...(canPing ? { pingRole } : {}) })}>
              {t("save")}
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setText(serverText);
                  setPingRole(serverPing);
                }}
              >
                {tc("discard")}
              </Button>
            )}
            {(status === "draft" || (status === "failed" && !hasSent)) && (
              <Button type="button" disabled={busy || postBlocked} onClick={() => setConfirmOpen(true)}>
                {t("post")}
              </Button>
            )}
            {(status === "partial" || stale || (status === "failed" && hasSent)) && (
              <Button type="button" disabled={busy || postBlocked} onClick={() => resume.mutate({ id: requestId, kind })}>
                {t("resume")}
              </Button>
            )}
            {(status === "posted" || (status === "partial" && hasSent)) && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                {t("edit")}
              </Button>
            )}
            {(status === "posted" || status === "partial" || status === "failed" || stale) && hasSent && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOpen(true)}>
                {t("delete")}
              </Button>
            )}
            {post && status !== "sending" && (
              <Button type="button" variant="outline" disabled={busy || testSend.isPending || testing || testBlocked} aria-describedby={`${id}-note`} onClick={sendTest}>
                {t("testSend")}
              </Button>
            )}
          </div>
          <div id={`${id}-note`} className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
            {reason && !dirty && (status === "draft" || status === "failed" || status === "partial" || stale) && <p>{reason}</p>}
            {post && status !== "sending" && !view.targets.staff && <p>{t("testReasonStaff")}</p>}
            {post && status !== "sending" && view.targets.staff && <p>{t("testHelp")}</p>}
          </div>
        </div>
      )}
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={post?.sentCount ?? 0}
        target={target}
        keepsText
        pending={remove.isPending}
        onConfirm={() => {
          setDeleteOpen(false);
          remove.mutate({ id: requestId, kind });
        }}
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmBody", { target: t(`target.${target}`) })} {post?.pingRole && view.pingRoleSet ? t("confirmPings") : t("confirmNoPing")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending}
              onClick={() => {
                setConfirmOpen(false);
                start.mutate({ id: requestId, kind });
              }}
            >
              {t("post")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
