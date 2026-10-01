"use client";

import { useQuery } from "@tanstack/react-query";
import { FileDiff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DocumentDiff } from "@/components/document-diff";
import { UpdateFromBriefDialog } from "@/components/events/update-from-brief-dialog";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/**
 * The "Brief changed since spec vN" banner of a project built from an event request. It shows nothing unless the brief moved
 * on since the spec's basis. "Show changes" opens the brief diff for those who may view the request; "Update from brief"
 * (editors) only opens the dialog with the command for the developer's agent.
 *
 * @param props.project the project slug
 * @param props.canEdit whether the viewer edits the project
 * @param props.system when set, the banner shows only for the request's own system
 */
export function BriefBanner({ project, canEdit, system }: { project: string; canEdit: boolean; system?: string }) {
  const t = useTranslations("events.briefBanner");
  const trpc = useTRPC();
  const [showing, setShowing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { data: status } = useQuery(trpc.requests.briefStatus.queryOptions({ project }));
  const canCompare = status?.state === "changed" && status.requestTitle !== null && status.basisBriefVersion !== null;
  const diff = useQuery({
    ...trpc.requests.compareBriefs.queryOptions({ id: status?.requestId ?? "", from: status?.basisBriefVersion ?? 1, to: status?.briefVersion ?? 2 }),
    enabled: showing && canCompare,
  });
  if (status?.state !== "changed" || (system !== undefined && status.systemSlug !== system)) return null;
  return (
    <section aria-label={t("title", { version: status.specVersion ?? 0 })} className="flex flex-col gap-3 border bg-muted p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FileDiff aria-hidden className="size-4 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[14px] font-semibold">{t("title", { version: status.specVersion ?? 0 })}</h2>
          <p className="text-[13px] text-fg-2">{t("changes", { count: status.changeCount })}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canCompare && (
            <Button type="button" size="sm" variant="outline" aria-expanded={showing} onClick={() => setShowing(!showing)}>
              {showing ? t("hide") : t("show")}
            </Button>
          )}
          {canEdit && (
            <Button type="button" size="sm" onClick={() => setUpdating(true)}>
              {t("update")}
            </Button>
          )}
        </div>
      </div>
      {showing && diff.data && status.basisBriefVersion !== null && (
        <div className="flex flex-col gap-2 bg-card p-3">
          <h3 className="text-[13px] font-semibold">{t("diffTitle", { from: status.basisBriefVersion, to: status.briefVersion })}</h3>
          <DocumentDiff hunks={diff.data.hunks} added={diff.data.added} removed={diff.data.removed} from={status.basisBriefVersion} to={status.briefVersion} />
        </div>
      )}
      {canEdit && <UpdateFromBriefDialog requestId={status.requestId} open={updating} onOpenChange={setUpdating} />}
    </section>
  );
}
