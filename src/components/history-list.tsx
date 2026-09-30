import { History } from "lucide-react";
import type { HistoryEntry } from "@/lib/ops/activity";
import { changeItems, Timeline } from "./activity/timeline";
import { EmptyState } from "./page";

/** A change log entry with its timestamp as an ISO string. */
export type HistoryView = Omit<HistoryEntry, "createdAt"> & { createdAt: string };

/**
 * Renders change log entries as readable sentences in a Tide timeline grouped
 * by day, newest first. On a system's page pass the system so sentences name
 * and link it; without it they leave the system out ("moved In progress → Review").
 *
 * @param props.showEntity kept for older callers; sentences always say what changed
 */
export function HistoryList({
  entries,
  projectSlug = "",
  system,
}: {
  entries: HistoryView[];
  showEntity?: boolean;
  projectSlug?: string;
  system?: { id: string; slug: string; title: string };
}) {
  if (entries.length === 0) {
    return <EmptyState icon={<History />} title="No changes yet" description="Every change to systems, tasks and documents shows up here." />;
  }
  const systems = new Map(system ? [[system.id, { slug: system.slug, title: system.title }]] : []);
  return <Timeline items={changeItems(entries, systems)} projectSlug={projectSlug} />;
}
