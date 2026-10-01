import { Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GateResult } from "@/lib/ops/gates";

/**
 * How far a system is from the next gated column: "Review ready" with a check when every
 * rule holds, otherwise "Review 2/3" with the unmet rules in a tooltip. Screen readers get
 * "Review rules: 2 of 3 met".
 */
export function GateStatus({ gate }: { gate: GateResult }) {
  const ready = gate.met === gate.total;
  const reader = <span className="sr-only">{`${gate.column} rules: ${gate.met} of ${gate.total} met`}</span>;
  if (ready) {
    return (
      <span className="flex items-center gap-1 text-[11.5px] text-cat-done">
        <Check aria-hidden className="size-3" />
        <span aria-hidden>{gate.column} ready</span>
        {reader}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[11.5px] text-muted-foreground">
          <span aria-hidden>
            {gate.column} {gate.met}/{gate.total}
          </span>
          {reader}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="list-disc pl-3.5">
          {gate.unmet.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
