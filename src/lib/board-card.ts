import type { Priority } from "@/db/schema";

/** A system card on the board. */
export interface BoardCardView {
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
  /** Summary of the system's newest update; shown as the reason while it is blocked. */
  latestSummary: string | null;
}
