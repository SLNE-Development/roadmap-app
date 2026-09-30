import { Badge } from "@/components/ui/badge";
import type { PlanningRoundView } from "@/lib/ops/planning";
import { Markdown } from "./markdown";

/** Every planning round with its questions, area, risk marker, state and answer, then the user's confirmation. */
export function PlanningRounds({ rounds, confirmation }: { rounds: PlanningRoundView[]; confirmation: string | null }) {
  if (rounds.length === 0) return <p className="text-sm text-muted-foreground">The planning interview has not started.</p>;
  return (
    <div className="flex flex-col gap-4">
      {rounds.map((r) => (
        <section key={r.number} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Round {r.number} <span className="font-normal text-muted-foreground">· {r.author} · {r.createdAt.toISOString().slice(0, 10)}</span>
          </h3>
          <ol className="flex flex-col gap-2">
            {r.items.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{i.area}</Badge>
                  {i.isRisk && <Badge variant="destructive">risk</Badge>}
                  <Badge variant={i.status === "open" ? "outline" : "secondary"}>{i.status}</Badge>
                </div>
                <p className="text-sm font-medium">{i.question}</p>
                {i.answer && <Markdown className="text-sm text-muted-foreground">{i.answer}</Markdown>}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {confirmation && (
        <blockquote className="border-l-2 border-primary pl-3 text-sm">
          <span className="font-medium">Confirmed by the user:</span> {confirmation}
        </blockquote>
      )}
    </div>
  );
}
