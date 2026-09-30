import { MessageSquareText } from "lucide-react";
import type { UpdateItem } from "@/lib/ops/updates";
import { Timeline, updateItems } from "./activity/timeline";
import { EmptyState } from "./page";

/** A progress update with its timestamp as an ISO string. */
export type UpdateView = Omit<UpdateItem, "createdAt"> & { createdAt: string };

/**
 * Renders progress updates as a Tide timeline grouped by day, newest first.
 *
 * @param props.showSystem whether each entry names and links its system (project feed)
 */
export function UpdateList({ updates, showSystem = false, projectSlug }: { updates: UpdateView[]; showSystem?: boolean; projectSlug: string }) {
  if (updates.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquareText />}
        title="No progress updates yet"
        description="Agents post an update after each piece of work; people can post them over MCP too."
      />
    );
  }
  return <Timeline items={updateItems(updates)} projectSlug={projectSlug} hideSystem={!showSystem} />;
}
