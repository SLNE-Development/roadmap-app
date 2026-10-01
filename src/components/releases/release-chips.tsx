import { useTranslations } from "next-intl";
import { StatusChip } from "@/components/chips";
import type { ColumnCategory } from "@/db/schema";
import type { ReleaseRisk } from "@/lib/ops/releases";

/** The category colour of each release status; the label is `insight.releases.status.<status>`. */
const STATUS: Record<"planned" | "frozen" | "shipped", { category: ColumnCategory }> = {
  planned: { category: "todo" },
  frozen: { category: "review" },
  shipped: { category: "done" },
};

/** The category colour of each slip risk; the label is `insight.releases.risk.<risk>`. */
const RISK: Record<ReleaseRisk, { category: ColumnCategory }> = {
  "on-track": { category: "done" },
  "at-risk": { category: "review" },
  late: { category: "blocked" },
  unknown: { category: "todo" },
};

/** A release's status as a chip: planned is todo-coloured, frozen review-coloured, shipped done-coloured. */
export function ReleaseStatusChip({ status }: { status: keyof typeof STATUS }) {
  const t = useTranslations("insight.releases.status");
  return <StatusChip category={STATUS[status].category} name={t(status)} />;
}

/** A release's slip risk as a chip. */
export function ReleaseRiskChip({ risk }: { risk: ReleaseRisk }) {
  const t = useTranslations("insight.releases.risk");
  return <StatusChip category={RISK[risk].category} name={t(risk)} />;
}
