import type { Priority } from "@/db/schema";

/** A system card on the board. */
export interface BoardCardView {
  id: string;
  slug: string;
  title: string;
  priority: Priority;
  ownerUserId: string | null;
  ownerName: string | null;
  domainId: string | null;
  phaseId: string | null;
  columnId: string;
  /** Planning areas (of 4) with an answered or accepted-risk item. */
  planningAreasCovered: number;
  /** Planning interview rounds recorded so far. */
  planningRounds: number;
  tasksDone: number;
  tasksTotal: number;
  /** Unresolved questions about the system. */
  openQuestions: number;
  /** Estimate points of all tasks and of the done ones. */
  points: number;
  pointsDone: number;
  /** Slugs of the dependencies that are not done yet. */
  blockedBy: string[];
  /** Custom field values by field key. */
  fields: Record<string, string>;
  /** Summary of the system's newest update; shown as the reason while it is blocked. */
  latestSummary: string | null;
  /** An open pull request of the system has failing checks. */
  failingChecks?: boolean;
}
