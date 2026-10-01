"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { BriefDiff, BriefHistory } from "@/components/events/brief-history";
import { DirtyBar } from "@/components/events/dirty-bar";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { EmptyState, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { RequestDetail } from "@/lib/ops/requests";
import { useTRPC } from "@/trpc/client";

/** The text as the server stores it, so trailing whitespace alone is no change. */
const normalized = (text: string) => text.replace(/\r\n/g, "\n").trim();

/** The brief editor: a Markdown editor saving new versions, with a conflict row inside its footer and a Reload button. */
function BriefEditor({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events.brief");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const id = useId();
  const requestId = detail.request.id;
  const [body, setBody] = useState(detail.brief);
  // The text and version the server has; a refetch never touches them, only a save or Reload does.
  const [saved, setSaved] = useState(detail.brief);
  const [base, setBase] = useState(detail.request.briefVersion);
  const [conflict, setConflict] = useState(false);
  // A conflict shows its own row and a Reload button, so the generic error toast is skipped.
  const save = useMutation(
    trpc.requests.saveBrief.mutationOptions({
      meta: { quiet: true },
      // The baseline is what was sent; text typed while the save ran stays unsaved.
      onSuccess: ({ version, changed }, vars) => {
        setConflict(false);
        setBase(version);
        setSaved(vars.body);
        toast.success(changed ? t("saved", { version }) : t("unchanged"));
      },
      onError: (error) => {
        if (error.data?.code === "CONFLICT") setConflict(true);
        else toast.error(error.message);
      },
    }),
  );
  const reload = async () => {
    const latest = await queryClient.fetchQuery({ ...trpc.requests.get.queryOptions({ id: requestId }), staleTime: 0 });
    setBody(latest.brief);
    setSaved(latest.brief);
    setBase(latest.request.briefVersion);
    setConflict(false);
  };
  const dirty = normalized(body) !== normalized(saved);
  return (
    <Panel title={t("label")} meta={base === 0 ? t("noVersion") : t("currentVersion", { version: base })} bodyClassName="pb-0">
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        <p className="text-[13px] text-fg-2">{t("help")}</p>
        <MarkdownEditor
          id={id}
          aria-label={t("label")}
          value={body}
          onChange={setBody}
          maxLength={50_000}
          minRows={16}
          placeholder={t("placeholder")}
          footer={
            conflict && (
              <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-destructive">
                <span className="min-w-0">{t("conflict")}</span>
                <Button type="button" size="xs" variant="outline" onClick={reload}>
                  {t("reload")}
                </Button>
              </p>
            )
          }
        />
      </div>
      <DirtyBar
        dirty={dirty}
        canSave
        pending={save.isPending}
        saveLabel={t("save", { version: base + 1 })}
        onSave={() => save.mutate({ id: requestId, body, baseVersion: base })}
        onDiscard={() => {
          setBody(saved);
          setConflict(false);
        }}
      />
    </Panel>
  );
}

/**
 * The Brief tab: the editor (or the rendered brief when it can no longer be edited) beside the version list.
 *
 * @param props.detail the request with the actor's rights
 * @param props.editable whether the brief may be changed now
 */
export function BriefTab({ detail, editable }: { detail: RequestDetail; editable: boolean }) {
  const t = useTranslations("events.brief");
  const { request, canEdit } = detail;
  const [comparing, setComparing] = useState<number | null>(null);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-5">
        {canEdit && editable ? (
          <BriefEditor key={request.id} detail={detail} />
        ) : (
          <Panel title={t("label")} meta={canEdit ? t("readOnly") : undefined} bodyClassName="px-4 pb-5 sm:px-5">
            {detail.brief.trim() ? <Markdown>{detail.brief}</Markdown> : <EmptyState title={t("emptyTitle")} description={t("emptyText")} />}
          </Panel>
        )}
        <BriefDiff requestId={request.id} currentVersion={request.briefVersion} from={comparing} onClose={() => setComparing(null)} />
      </div>
      <BriefHistory requestId={request.id} currentVersion={request.briefVersion} comparing={comparing} onCompare={setComparing} />
    </div>
  );
}
