import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/page";
import type { PlanningRoundView } from "@/lib/ops/planning";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Tag } from "./chips";
import { Markdown } from "./markdown";
import { AuthorText } from "./system/author";
import { AREA_LABEL, ITEM_STATUS_LABEL, ITEM_STATUS_TEXT } from "./system/text";

/**
 * The user's own words confirming the spec, as a quote on a sunken block.
 *
 * @param props.completedAt when planning was completed, as an ISO string
 */
export function ConfirmationQuote({ confirmation, completedAt, className }: { confirmation: string; completedAt: string | null; className?: string }) {
  return (
    <blockquote className={cn("bg-secondary px-3 py-2.5 text-[13px] leading-normal text-fg-2", className)}>
      “{confirmation}”
      <span className="mt-1 block text-xs text-muted-foreground">Confirmed by the user{completedAt ? ` · ${formatDate(completedAt)}` : ""}</span>
    </blockquote>
  );
}

/**
 * Every planning round with its questions: the area as a tag, a risk tag,
 * the state, and the answer on a sunken block; then the user's confirmation.
 *
 * @param props.completedAt when planning was completed, as an ISO string
 */
export function PlanningRounds({
  rounds,
  confirmation,
  completedAt,
}: {
  rounds: PlanningRoundView[];
  confirmation: string | null;
  completedAt: string | null;
}) {
  if (rounds.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare />}
        title="The planning interview has not started"
        description="An agent asks the first round of questions about scope, dependencies, failure modes and testing."
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {rounds.map((r) => (
        <section key={r.number} className="flex flex-col border bg-card">
          <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-4 pb-3 sm:px-5">
            <h2 className="font-display text-[19px] font-semibold">Round {r.number}</h2>
            <span className="text-[12.5px] text-muted-foreground">
              <AuthorText name={r.authorName} agent={r.agent} /> · {formatDate(r.createdAt.toISOString())} · {r.items.length}{" "}
              {r.items.length === 1 ? "question" : "questions"}
            </span>
          </header>
          <ol className="flex flex-col">
            {r.items.map((i) => (
              <li key={i.id} className="flex flex-col gap-2 border-t px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag>{AREA_LABEL[i.area] ?? i.area}</Tag>
                  {i.isRisk && <Tag className="bg-danger-soft text-destructive">Risk</Tag>}
                  <span className={cn("ml-auto text-xs font-semibold", ITEM_STATUS_TEXT[i.status])}>{ITEM_STATUS_LABEL[i.status]}</span>
                </div>
                <p className="text-sm font-medium">{i.question}</p>
                {i.answer ? (
                  <div className="bg-secondary px-3 py-2.5">
                    <Markdown className="text-sm text-fg-2">{i.answer}</Markdown>
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No answer yet.</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {confirmation && <ConfirmationQuote confirmation={confirmation} completedAt={completedAt} className="px-4 py-3.5 text-sm" />}
    </div>
  );
}
