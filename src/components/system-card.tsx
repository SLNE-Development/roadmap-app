import Link from "next/link";
import type { SystemListItem } from "@/lib/ops/systems";
import { relativeAge } from "@/lib/time";
import { CATEGORY_CLASS, PriorityTag, StatusChip } from "./chips";
import { ProgressBar } from "./page";
import { PersonAvatar } from "./person-avatar";

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
}: {
  system: SystemListItem;
  latest?: { summary: string; createdAt: string };
  projectSlug: string;
  domainName?: string | null;
}) {
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
        {latest && <span className="text-[11.5px] text-muted-foreground">Updated {relativeAge(latest.createdAt)}</span>}
      </div>
      <div className="mt-auto flex items-center gap-2">
        <ProgressBar value={system.tasksDone} total={system.tasksTotal} colorClass={CATEGORY_CLASS[system.columnCategory]} />
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {system.tasksDone}/{system.tasksTotal}
        </span>
        {system.ownerName ? (
          <span title={system.ownerName} className="flex">
            <PersonAvatar name={system.ownerName} size="sm" />
            <span className="sr-only">Owner {system.ownerName}</span>
          </span>
        ) : (
          <span className="sr-only">Unowned</span>
        )}
      </div>
    </Link>
  );
}
