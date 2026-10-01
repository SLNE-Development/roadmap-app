"use client";

import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { textLength } from "@/lib/discord-limits";
import { MAX_POST_TEXT, POST_TARGET } from "@/lib/event-messages";
import { VISIBLE_PLACEHOLDERS } from "@/lib/event-placeholders";
import type { PostsView, PostView } from "@/lib/ops/request-posts";
import { useTRPC } from "@/trpc/client";

/** The kinds this tab writes; disaster and resolved posts live elsewhere. */
const KINDS = ["team", "announcement", "reminder"] as const;
type Kind = (typeof KINDS)[number];

/** Statuses in which the text can no longer be edited as a draft; a posted or partial post is changed through Edit. */
const LOCKED = ["sending", "partial", "posted"];

/** How long the card waits for the result of a test send before it gives up. */
const TEST_WAIT_MS = 60_000;

/** The badge colour of each status. */
const STATUS_VARIANT = { draft: "outline", sending: "secondary", partial: "destructive", posted: "default", failed: "destructive", deleted: "outline" } as const;

/**
 * One card of the Messages tab: due date, editor with placeholder chips and counter, the ping checkbox, the preview of the
 * messages it becomes, the status, and the Save, Post now, Resume, Edit, Delete and Test send buttons. A button is disabled with its
 * reason shown.
 *
 * @param props.requestId the request
 * @param props.kind the kind of post
 * @param props.post the saved post, if any
 * @param props.view the posts view the card belongs to
 * @param props.requestStatus the request's status
 * @param props.canEdit whether the actor may change and post
 */
function PostCard({ requestId, kind, post, view, requestStatus, canEdit }: { requestId: string; kind: Kind; post: PostView | undefined; view: PostsView; requestStatus: string; canEdit: boolean }) {
  const t = useTranslations("events.messages");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const format = useFormatter();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(post?.text ?? "");
  const [pingRole, setPingRole] = useState(post?.pingRole ?? false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const target = POST_TARGET[kind];
  const status = post?.status ?? "draft";
  const editable = canEdit && (!LOCKED.includes(status) || editing);
  const hasSent = (post?.sentCount ?? 0) > 0;
  // A `sending` post whose job is lost can be resumed or deleted like a partial one.
  const stale = post?.stale === true;
  const dirty = text !== (post?.text ?? "") || pingRole !== (post?.pingRole ?? false);
  const due = view.dues[kind];
  const canPing = kind !== "team";
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
  const preview = useQuery({ ...trpc.requests.posts.preview.queryOptions({ id: requestId, kind }), enabled: post !== undefined });

  let reason: string | null = null;
  if (!view.targets[target]) reason = t("reasonWebhook", { target: t(`target.${target}`) });
  else if (requestStatus !== "accepted" && requestStatus !== "event_week") reason = t("reasonStatus");
  else if (dirty) reason = t("reasonDirty");
  else if (!post || post.text.trim() === "") reason = t("reasonEmpty");

  const insert = (token: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + token + text.slice(end));
  };
  const busy = save.isPending || start.isPending || resume.isPending || edit.isPending || remove.isPending;
  let testReason: string | null = null;
  if (!view.targets.staff) testReason = t("testReasonStaff");
  else if (!post || post.text.trim() === "") testReason = t("reasonEmpty");
  else if (dirty) testReason = t("reasonDirty");
  const reasonId = `${id}-reason`;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-title`} className="font-display text-[16px] font-semibold">
          {t(`kind.${kind}`)}
        </h3>
        <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
        {due.dueAt && (
          <Badge variant={due.late ? "destructive" : "outline"}>
            {due.late ? `${t("late")}: ` : ""}
            {t("due", { date: format.dateTime(due.dueAt, { day: "numeric", month: "short" }) })}
          </Badge>
        )}
        {post && post.partsCount > 0 && status !== "posted" && <span className="text-[12.5px] text-muted-foreground">{t("sentOf", { sent: post.sentCount, total: post.partsCount })}</span>}
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-text`}>{t("editor")}</FieldLabel>
        <Textarea
          id={`${id}-text`}
          ref={area}
          value={text}
          disabled={!editable}
          maxLength={MAX_POST_TEXT}
          className="min-h-40 font-mono text-[13px]"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
          <div role="group" aria-label={t("placeholders")} className="flex flex-wrap gap-1">
            {VISIBLE_PLACEHOLDERS.map((name) => (
              <Button key={name} type="button" size="xs" variant="outline" disabled={!editable} aria-label={t("insert", { name })} onClick={() => insert(`{${name}}`)}>
                {`{${name}}`}
              </Button>
            ))}
          </div>
          <span>{t("counter", { count: format.number(textLength(text)), max: format.number(MAX_POST_TEXT) })}</span>
        </div>
      </Field>
      {canPing && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-[13.5px]">
            <Checkbox checked={pingRole} disabled={!editable || editing || !view.pingRoleSet} onCheckedChange={(v) => setPingRole(v === true)} />
            {t("ping")}
          </label>
          {!view.pingRoleSet && <p className="text-[12.5px] text-muted-foreground">{t("pingUnset")}</p>}
        </div>
      )}
      {post && (
        <div className="flex flex-col gap-1 text-[13px]">
          {dirty ? (
            <p className="text-muted-foreground">{t("previewStale")}</p>
          ) : (
            preview.data && (
              <>
                <p className="font-semibold">
                  {t("preview", { count: preview.data.parts.length })}
                  {preview.data.parts.length > 0 &&
                    `: ${preview.data.parts.map((p) => (p.kind === "text" ? format.number(p.length) : t("previewCard"))).join(" / ")}`}
                </p>
                <ul className="flex flex-col gap-1">
                  {preview.data.parts.map((p, i) => (
                    <li key={i}>
                      <details>
                        <summary className="cursor-pointer text-fg-2">{t("previewMessage", { n: i + 1 })}</summary>
                        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap border bg-secondary p-2 text-[12.5px]">{p.content || t("previewCard")}</pre>
                      </details>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>
      )}
      {post?.status === "posted" && post.postedAt && (
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
                setText(post?.text ?? "");
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy || !editable || !dirty} onClick={() => save.mutate({ id: requestId, kind, text, ...(canPing ? { pingRole } : {}) })}>
              {t("save")}
            </Button>
            {(status === "draft" || (status === "failed" && !hasSent)) && (
              <Button type="button" disabled={busy || reason !== null} aria-describedby={reason ? reasonId : undefined} onClick={() => setConfirmOpen(true)}>
                {t("post")}
              </Button>
            )}
            {(status === "partial" || stale || (status === "failed" && hasSent)) && (
              <Button type="button" disabled={busy || reason !== null} aria-describedby={reason ? reasonId : undefined} onClick={() => resume.mutate({ id: requestId, kind })}>
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
              <Button type="button" variant="outline" disabled={busy || testSend.isPending || testing || testReason !== null} aria-describedby={testReason ? `${id}-test` : undefined} onClick={sendTest}>
                {t("testSend")}
              </Button>
            )}
          </div>
          {reason && (status === "draft" || status === "failed" || status === "partial" || stale) && (
            <p id={reasonId} className="text-[12.5px] text-muted-foreground">
              {reason}
            </p>
          )}
          {post && status !== "sending" && (
            <p id={`${id}-test`} className="text-[12.5px] text-muted-foreground">
              {testReason ?? t("testHelp")}
            </p>
          )}
        </div>
      )}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody", { count: post?.sentCount ?? 0, target: t(`target.${target}`) })}</DialogDescription>
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
                remove.mutate({ id: requestId, kind });
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("confirmBody", { target: t(`target.${target}`) })} {post?.pingRole && view.pingRoleSet ? t("confirmPings") : t("confirmNoPing")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={start.isPending}
              onClick={() => {
                setConfirmOpen(false);
                start.mutate({ id: requestId, kind });
              }}
            >
              {t("post")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * The Messages tab: a card for the team notice, the announcement and the reminder. While a post is being sent the list
 * refreshes every few seconds so its progress shows.
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
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {!canEdit && <p className="text-[13px] text-fg-2">{t("readOnly")}</p>}
      {KINDS.map((kind) => {
        const post = view.posts.find((p) => p.kind === kind);
        return <PostCard key={`${kind}-${post?.id ?? "new"}-${post?.status ?? "draft"}-${post?.text.length ?? 0}`} requestId={requestId} kind={kind} post={post} view={view} requestStatus={requestStatus} canEdit={canEdit} />;
      })}
    </div>
  );
}
