"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { DocumentDiff } from "@/components/document-diff";
import { EmptyState, Panel } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/** The newest version number of the request, falling back to the request's own while the list is empty. */
function useLatest(requestId: string, currentVersion: number) {
  const trpc = useTRPC();
  const { data: versions } = useSuspenseQuery(trpc.requests.briefVersions.queryOptions({ id: requestId }));
  return { versions, latest: versions[0]?.version ?? currentVersion };
}

/**
 * The versions of a request's brief, newest first, each with who saved it and when, in the Brief tab's rail.
 * "Compare" picks the older version whose changes {@link BriefDiff} shows.
 *
 * @param props.requestId the request
 * @param props.currentVersion the current brief version, so the list refetches when it changes
 * @param props.comparing the older version being compared with the current one, or null
 * @param props.onCompare called with the version to compare, or null to close the comparison
 */
export function BriefHistory({ requestId, currentVersion, comparing, onCompare }: { requestId: string; currentVersion: number; comparing: number | null; onCompare: (version: number | null) => void }) {
  const t = useTranslations("events.versions");
  const format = useFormatter();
  const { versions, latest } = useLatest(requestId, currentVersion);
  return (
    <Panel title={t("title")} bodyClassName="px-4 pb-4">
      {versions.length === 0 ? (
        <EmptyState title={t("none")} description={t("noneText")} className="py-6" />
      ) : (
        <ul className="flex flex-col divide-y border">
          {versions.map((v) => (
            <li key={v.version} className="flex flex-col gap-1 px-3 py-2.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t("version", { version: v.version })}</span>
                {v.version === latest && <Badge variant="secondary">{t("current")}</Badge>}
                {v.version < latest && (
                  <Button type="button" size="xs" variant="outline" className="ml-auto" aria-pressed={comparing === v.version} onClick={() => onCompare(comparing === v.version ? null : v.version)}>
                    {t("compare")}
                    <span className="sr-only"> {t("version", { version: v.version })}</span>
                  </Button>
                )}
              </div>
              <span className="flex items-center gap-1.5 text-fg-2">
                <PersonAvatar name={v.authorName} size="xs" />
                <span className="min-w-0 truncate">{t("meta", { name: v.authorName, date: format.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The line differences from an older brief version to the current one, in the main column under the editor.
 *
 * @param props.requestId the request
 * @param props.currentVersion the current brief version
 * @param props.from the older version, or null for nothing to show
 * @param props.onClose called by the close button
 */
export function BriefDiff({ requestId, currentVersion, from, onClose }: { requestId: string; currentVersion: number; from: number | null; onClose: () => void }) {
  const t = useTranslations("events.versions");
  const trpc = useTRPC();
  const { latest } = useLatest(requestId, currentVersion);
  const comparing = from !== null && from < latest ? from : null;
  const diff = useQuery({ ...trpc.requests.compareBriefs.queryOptions({ id: requestId, from: comparing ?? 1, to: latest }), enabled: comparing !== null });
  if (comparing === null || !diff.data) return null;
  return (
    <Panel
      title={t("diffTitle", { from: comparing, to: latest })}
      action={
        <Button type="button" size="xs" variant="ghost" onClick={onClose}>
          {t("closeDiff")}
        </Button>
      }
      bodyClassName="px-4 pb-4 sm:px-5"
    >
      <DocumentDiff hunks={diff.data.hunks} added={diff.data.added} removed={diff.data.removed} from={comparing} to={latest} />
    </Panel>
  );
}
