"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { MAX_POST_TEXT } from "@/lib/event-messages";
import { PROMPT_KINDS, type PromptKind } from "@/lib/event-prompts";
import { useTRPC } from "@/trpc/client";

/**
 * One tab of the dialog: the read-only prompt with its Copy button, and the paste-back box that saves the pasted text as
 * the draft of the matching post.
 *
 * @param props.requestId the request
 * @param props.kind the kind of prompt
 * @param props.prompt the prompt text
 * @param props.tabId the id of the tab button that labels this panel
 * @param props.panelId the id of this panel
 * @param props.onClose closes the dialog
 */
function PromptPanel({ requestId, kind, prompt, tabId, panelId, onClose }: { requestId: string; kind: PromptKind; prompt: string; tabId: string; panelId: string; onClose: () => void }) {
  const t = useTranslations("events.prompts");
  const trpc = useTRPC();
  const ids = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [pasted, setPasted] = useState("");
  const save = useMutation(trpc.requests.posts.savePasteBack.mutationOptions({ onSuccess: () => toast.success(t("saved")) }));

  /** Copies the prompt; when the browser refuses, selects it so the person can copy by hand. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(t("copied"));
    } catch {
      area.current?.select();
      toast.error(t("copyFailed"));
    }
  }

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={tabId} className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">{t("instruction")}</p>
      <Field>
        <FieldLabel htmlFor={`${ids}-prompt`}>{t("promptLabel")}</FieldLabel>
        <Textarea ref={area} id={`${ids}-prompt`} readOnly value={prompt} rows={10} className="font-mono text-[12px]" />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void copy()}>
            {t("copy")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => area.current?.select()}>
            {t("selectAll")}
          </Button>
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${ids}-paste`}>{t("pasteLabel")}</FieldLabel>
        <Textarea id={`${ids}-paste`} value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} maxLength={MAX_POST_TEXT} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={save.isPending || !pasted.trim()} onClick={() => save.mutate({ id: requestId, kind, text: pasted })}>
            {t("saveDraft")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/requests/${requestId}?tab=messages`} onClick={onClose}>{t("openMessages")}</Link>
          </Button>
        </div>
        {save.error && (
          <p role="alert" className="text-[13px] text-destructive">
            {save.error.message}
          </p>
        )}
      </Field>
    </div>
  );
}

/**
 * The copy-prompts dialog: three tabs (announcement, reminder, team message), each with a prompt to copy into any chat
 * assistant and a box to paste the answer back as a draft. The app calls no assistant itself.
 *
 * @param props.requestId the request
 * @param props.open whether the dialog is shown
 * @param props.onOpenChange called when it opens or closes
 */
export function CopyPromptsDialog({ requestId, open, onOpenChange }: { requestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("events.prompts");
  const trpc = useTRPC();
  const [kind, setKind] = useState<PromptKind>("announcement");
  const prompts = useQuery({ ...trpc.requests.prompts.queryOptions({ id: requestId }), enabled: open });
  const ids = useId();
  const tabId = (k: PromptKind) => `${ids}-tab-${k}`;
  const panelId = `${ids}-panel`;

  /** Moves between the tabs with the arrow keys, Home and End. */
  function onTabKey(e: React.KeyboardEvent, index: number) {
    const last = PROMPT_KINDS.length - 1;
    const next = e.key === "ArrowRight" ? (index + 1) % (last + 1) : e.key === "ArrowLeft" ? (index + last) % (last + 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setKind(PROMPT_KINDS[next]);
    document.getElementById(tabId(PROMPT_KINDS[next]))?.focus();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label={t("tabs")} className="flex gap-1 border-b">
          {PROMPT_KINDS.map((k, i) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={tabId(k)}
              aria-selected={kind === k}
              aria-controls={panelId}
              tabIndex={kind === k ? 0 : -1}
              onClick={() => setKind(k)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={`px-3 py-2 text-[13px] ${kind === k ? "border-b-2 border-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
        {prompts.isPending && <p role="status">{t("loading")}</p>}
        {prompts.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {prompts.error.message}
          </p>
        )}
        {prompts.data && <PromptPanel key={kind} requestId={requestId} kind={kind} prompt={prompts.data[kind]} tabId={tabId(kind)} panelId={panelId} onClose={() => onOpenChange(false)} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
