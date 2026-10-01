"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { DocumentDiff } from "@/components/document-diff";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/**
 * The versions of a request's brief, newest first, each with who saved it and when. "Compare with current"
 * shows the line differences from that version to the current one.
 *
 * @param props.requestId the request
 * @param props.currentVersion the current brief version, so the list refetches when it changes
 */
export function BriefHistory({ requestId, currentVersion }: { requestId: string; currentVersion: number }) {
  const t = useTranslations("events.versions");
  const trpc = useTRPC();
  const format = useFormatter();
  const [from, setFrom] = useState<number | null>(null);
  const { data: versions } = useSuspenseQuery(trpc.requests.briefVersions.queryOptions({ id: requestId }));
  const latest = versions[0]?.version ?? currentVersion;
  const comparing = from !== null && from < latest ? from : null;
  const diff = useQuery({ ...trpc.requests.compareBriefs.queryOptions({ id: requestId, from: comparing ?? 1, to: latest }), enabled: comparing !== null });
  if (versions.length === 0) {
    return (
      <Panel title={t("title")} bodyClassName="gap-3 px-4 pb-4 sm:px-5">
        <p className="text-[13px] text-muted-foreground">{t("none")}</p>
      </Panel>
    );
  }
  return (
    <Panel title={t("title")} bodyClassName="gap-3 px-4 pb-4 sm:px-5">
      <ul className="flex flex-col divide-y border">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
            <span className="font-semibold">{t("version", { version: v.version })}</span>
            {v.version === latest && <span className="text-muted-foreground">{t("current")}</span>}
            <span className="text-fg-2">
              {t("meta", { name: v.authorName, date: format.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
            </span>
            {v.version < latest && (
              <Button type="button" size="xs" variant="outline" className="ml-auto" aria-pressed={comparing === v.version} onClick={() => setFrom(comparing === v.version ? null : v.version)}>
                {t("compare")}
                <span className="sr-only"> {t("version", { version: v.version })}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {comparing !== null && diff.data && (
        <section aria-label={t("diffTitle", { from: comparing, to: latest })} className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-[13px] font-semibold">{t("diffTitle", { from: comparing, to: latest })}</h3>
            <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={() => setFrom(null)}>
              {t("closeDiff")}
            </Button>
          </div>
          <DocumentDiff hunks={diff.data.hunks} added={diff.data.added} removed={diff.data.removed} from={comparing} to={latest} />
        </section>
      )}
    </Panel>
  );
}
