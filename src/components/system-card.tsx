import { Link2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useNow } from "@/components/clock";
import { GateStatus } from "@/components/gate-status";
import type { GateResult } from "@/lib/ops/gates";
import type { SystemPresence } from "@/lib/ops/presence";
import type { SystemListItem } from "@/lib/ops/systems";
import { CATEGORY_CLASS, PriorityTag, StatusChip } from "./chips";
import { ProgressBar } from "./page";
import { PersonAvatar } from "./person-avatar";
import { PresenceStack } from "./presence/presence-stack";

/**
 * A Tide card for one system: domain and priority, title, status, task
 * progress coloured by its category, and the owner's avatar.
 *
 * @param props.domainName the name of the system's domain, when it has one
 * @param props.latest the newest progress update, shown as "Updated …"
 */
export function SystemCard({
  system,
  latest,
  projectSlug,
  domainName,
  gate,
  present,
}: {
  system: SystemListItem;
  latest?: { summary: string; createdAt: string };
  projectSlug: string;
  domainName?: string | null;
  gate?: GateResult;
  /** Who is on the system now, shown as a small stack in the footer. */
  present?: SystemPresence;
}) {
  const t = useTranslations("systems.card");
  const format = useFormatter();
  const now = useNow();
  return (
    <Link
      href={`/p/${projectSlug}/systems/${system.slug}`}
      className="flex h-full flex-col gap-2 border border-border bg-card p-3 transition-colors hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{domainName ?? system.boardName}</span>
        <PriorityTag priority={system.priority} />
      </div>
      <span className="text-[13.5px] leading-[1.35] font-semibold">{system.title}</span>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip category={system.columnCategory} name={system.columnName} />
        {system.archivedAt && <span className="bg-muted px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">{t("archived")}</span>}
        {system.tasksBlocked > 0 && (
          <span className="bg-cat-blocked-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-cat-blocked">
            <span aria-hidden>{t("blocked", { count: system.tasksBlocked })}</span>
            <span className="sr-only">{t("blockedSr", { count: system.tasksBlocked })}</span>
          </span>
        )}
        {system.blockedBy.length > 0 && (
          <span className="flex items-center gap-1 bg-cat-blocked-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-cat-blocked" title={t("blockedByTitle", { names: format.list(system.blockedBy) })}>
            <Link2 aria-hidden className="size-3" />
            {t("blockedBy", { count: system.blockedBy.length })}
          </span>
        )}
        {gate && <GateStatus gate={gate} />}
        {latest && <span className="text-[11.5px] text-muted-foreground">{t("updated", { age: format.relativeTime(new Date(latest.createdAt), now) })}</span>}
      </div>
      <div className="mt-auto flex items-center gap-2">
        <ProgressBar value={system.tasksDone} total={system.tasksTotal} colorClass={CATEGORY_CLASS[system.columnCategory]} />
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {system.tasksDone}/{system.tasksTotal}
        </span>
        {present && <PresenceStack people={present.people} agents={present.agents} size="xs" max={2} />}
        {system.ownerName ? (
          <span title={system.ownerName} className="flex">
            <PersonAvatar name={system.ownerName} size="sm" />
            <span className="sr-only">{t("ownerSr", { name: system.ownerName })}</span>
          </span>
        ) : (
          <span className="sr-only">{t("unowned")}</span>
        )}
      </div>
    </Link>
  );
}
