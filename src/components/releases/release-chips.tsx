import { StatusChip } from "@/components/chips";
import type { ColumnCategory } from "@/db/schema";
import type { ReleaseRisk } from "@/lib/ops/releases";

/** The category colour and label of each release status. */
const STATUS: Record<"planned" | "frozen" | "shipped", { category: ColumnCategory; label: string }> = {
  planned: { category: "todo", label: "Planned" },
  frozen: { category: "review", label: "Frozen" },
  shipped: { category: "done", label: "Shipped" },
};

/** The category colour and label of each slip risk. */
const RISK: Record<ReleaseRisk, { category: ColumnCategory; label: string }> = {
  "on-track": { category: "done", label: "On track" },
  "at-risk": { category: "review", label: "At risk" },
  late: { category: "blocked", label: "Late" },
  unknown: { category: "todo", label: "No forecast" },
};

/** A release's status as a chip: planned is todo-coloured, frozen review-coloured, shipped done-coloured. */
export function ReleaseStatusChip({ status }: { status: keyof typeof STATUS }) {
  return <StatusChip category={STATUS[status].category} name={STATUS[status].label} />;
}

/** A release's slip risk as a chip. */
export function ReleaseRiskChip({ risk }: { risk: ReleaseRisk }) {
  return <StatusChip category={RISK[risk].category} name={RISK[risk].label} />;
}
