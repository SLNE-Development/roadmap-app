"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { DiscordPreview } from "@/components/events/discord-preview";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { fillPlaceholders } from "@/lib/event-placeholders";
import type { RequestStatus } from "@/lib/event-status";
import { useTRPC } from "@/trpc/client";

/** The confirmations that need no input: the dialog for each, in `events.dialogs`. */
export type ConfirmKind = "complete" | "withdraw" | "startWeek" | "reopen";

/**
 * The confirmation of a lifecycle step (complete, withdraw, start the event week, reopen) that runs the step once confirmed.
 *
 * @param props.kind the step asked about, null while the dialog is closed
 * @param props.status the request's status; a reopened request returns to accepted when cancelled and to draft when withdrawn
 * @param props.onClose called when the dialog is dismissed or the step succeeded
 */
export function LifecycleDialog({ kind, requestId, status, onClose }: { kind: ConfirmKind | null; requestId: string; status: RequestStatus; onClose: () => void }) {
  const t = useTranslations("events");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  // The text stays while the dialog fades out.
  const [last, setLast] = useState<ConfirmKind>("complete");
  if (kind && kind !== last) setLast(kind);
  const shown = kind ?? last;
  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      onClose();
    },
  });
  const complete = useMutation(trpc.requests.markDone.mutationOptions(done(t("actions.done"))));
  const withdraw = useMutation(trpc.requests.withdraw.mutationOptions(done(t("actions.withdrawn"))));
  const startWeek = useMutation(trpc.requests.startEventWeek.mutationOptions(done(t("actions.eventWeekStarted"))));
  const reopen = useMutation(trpc.requests.reopen.mutationOptions(done(t("actions.reopened"))));
  const step = { complete, withdraw, startWeek, reopen }[shown];
  const key = shown === "reopen" ? (status === "withdrawn" ? "reopenWithdrawn" : "reopenCancelled") : shown;
  return (
    <AlertDialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`dialogs.${key}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`dialogs.${key}.description`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={step.isPending}
            variant={shown === "withdraw" ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              step.mutate({ id: requestId });
            }}
          >
            {t(`dialogs.${key}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The cancel dialog: a required reason in a compact Markdown editor and what cancelling posts. When the announcement is
 * in Discord, the filled cancelled embed shows as the preview; otherwise one line says why nothing is sent.
 */
export function CancelDialog({ requestId, open, onOpenChange }: { requestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("events.dialogs.cancel");
  const trpc = useTRPC();
  const locale = useLocale();
  const zone = useTimeZone() ?? "UTC";
  const id = useId();
  const [reason, setReason] = useState("");
  const preview = useQuery({ ...trpc.requests.cancelPreview.queryOptions({ id: requestId }), enabled: open });
  const settings = useQuery({ ...trpc.requests.settings.get.queryOptions(), enabled: open });
  const cancel = useMutation(
    trpc.requests.cancel.mutationOptions({
      onSuccess: () => {
        onOpenChange(false);
        setReason("");
        toast.success(t("cancelled"));
      },
    }),
  );
  const embed = preview.data?.embed;
  const fill = (text: string) => fillPlaceholders(text, { note: reason.trim() }, { allow: ["note"] });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="flex min-w-0 flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate({ id: requestId, reason: reason.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={id}>{t("reason")}</FieldLabel>
            <MarkdownEditor id={id} variant="compact" value={reason} onChange={setReason} maxLength={1000} minRows={4} />
            <FieldDescription>{t("reasonHelp")}</FieldDescription>
          </Field>
          {preview.data?.willPost && embed && (
            <div className="flex min-w-0 flex-col gap-2">
              <DiscordPreview
                parts={[{ kind: "embed", content: "", embed: { ...embed, title: fill(embed.title), description: fill(embed.description) } }]}
                postAs={settings.data?.postAs ?? "Events"}
                locale={locale}
                timeZone={settings.data?.timeZone ?? zone}
              />
              <p className="text-[13px] text-fg-2">{t("posts")}</p>
            </div>
          )}
          {preview.data?.reason === "not-posted" && <p className="text-[13px] text-fg-2">{t("notPosted")}</p>}
          {preview.data?.reason === "no-webhook" && (
            <p role="status" className="bg-danger-soft px-3 py-2 text-[13px] text-destructive">
              {t("noWebhook")}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("keep")}
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={cancel.isPending || !reason.trim()}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The delete dialog. When a project was created from the event, asks what happens to it (keep, archive or delete) with the
 * options the actor lacks disabled and explained. Goes to the list once the request is gone.
 */
export function DeleteDialog({ requestId, open, onOpenChange }: { requestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("events.dialogs.delete");
  const tc = useTranslations("common");
  const ta = useTranslations("events.actions");
  const trpc = useTRPC();
  const router = useRouter();
  const id = useId();
  const [choice, setChoice] = useState<"keep" | "archive" | "delete">("keep");
  const choices = useQuery({ ...trpc.requests.deleteChoices.queryOptions({ id: requestId }), enabled: open });
  const remove = useMutation(
    trpc.requests.delete.mutationOptions({
      onSuccess: () => {
        toast.success(ta("deleted"));
        onOpenChange(false);
        router.push("/requests");
      },
    }),
  );
  const info = choices.data;
  const project = info?.project ?? null;
  const options = project
    ? ([
        { value: "keep", label: t("keep"), reason: null },
        { value: "archive", label: t("archive"), reason: !project.canArchive ? t("ownerOnly") : project.archived ? t("alreadyArchived") : null },
        { value: "delete", label: t("delete"), reason: !project.canDelete ? t("ownerOnly") : null },
      ] as const)
    : [];
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{info && !info.allowed && info.reason ? info.reason : t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {project && !project.created && <p className="text-[13px] text-fg-2">{t("projectLinked", { name: project.name })}</p>}
        {project?.created && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13.5px] font-semibold">{t("projectTitle")}</legend>
            <p className="text-[13px] text-fg-2">{t("projectCreated", { name: project.name })}</p>
            {options.map((o) => (
              <label key={o.value} htmlFor={`${id}-${o.value}`} className="flex items-start gap-2.5 border bg-card px-3 py-2 text-[13.5px] has-[:disabled]:opacity-60">
                <input
                  id={`${id}-${o.value}`}
                  type="radio"
                  name={`${id}-project`}
                  className="mt-1 accent-primary"
                  checked={choice === o.value}
                  disabled={o.reason !== null}
                  onChange={() => setChoice(o.value)}
                />
                <span className="flex flex-col">
                  {o.label}
                  {o.reason && <span className="text-[12.5px] text-muted-foreground">{o.reason}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending || !info?.allowed}
            onClick={(e) => {
              e.preventDefault();
              remove.mutate({ id: requestId, project: project?.created ? choice : "keep" });
            }}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
