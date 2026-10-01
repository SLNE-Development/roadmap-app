"use client";

import { CalendarDays, ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RequestRow } from "@/components/events/request-row";
import { EmptyState, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { isOpen, type RequestStatus } from "@/lib/event-status";
import type { RequestListItem } from "@/lib/ops/requests";
import { cn } from "@/lib/utils";

/** The filter chips: the statuses of an event's life, then the two that ended without happening. */
const CHIPS = ["draft", "submitted", "accepted", "event_week", "done", "closed"] as const;
type Chip = (typeof CHIPS)[number];

/** The statuses a chip stands for. */
function statusesOf(chip: Chip): readonly RequestStatus[] {
  return chip === "closed" ? ["withdrawn", "cancelled"] : [chip];
}

const CHIP_BASE = "flex h-8 items-center gap-1.5 px-2.5 text-[13px] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** A toggle chip in the style of the app's filter chips. */
function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(CHIP_BASE, on ? "border border-primary bg-brand-soft font-medium text-brand-strong" : "border border-dashed text-fg-2 hover:text-foreground")}
    >
      {children}
    </button>
  );
}

/** The requests grouped into sections, with a search, status chips and a "Mine" toggle above them. */
export function RequestList({ rows, userId }: { rows: RequestListItem[]; userId: string }) {
  const t = useTranslations("events");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<Chip>>(new Set());
  const [mine, setMine] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const toggle = (chip: Chip) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(chip)) next.add(chip);
      return next;
    });
  const count = (chip: Chip) => rows.filter((r) => statusesOf(chip).includes(r.status)).length;
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (needle === "" || r.title.toLowerCase().includes(needle)) &&
      (chosen.size === 0 || [...chosen].some((c) => statusesOf(c).includes(r.status))) &&
      (!mine || r.requesterId === userId || r.acceptedBy === userId),
  );
  const open = shown.filter((r) => isOpen(r.status));
  const rest = open.filter((r) => !r.needsActor);
  const sections = [
    { key: "sectionNeedsYou", rows: open.filter((r) => r.needsActor) },
    { key: "sectionUpcoming", rows: rest.filter((r) => r.status === "accepted" || r.status === "event_week") },
    { key: "sectionPipeline", rows: rest.filter((r) => r.status === "draft" || r.status === "submitted") },
  ] as const;
  const past = shown.filter((r) => !isOpen(r.status));
  const filtered = needle !== "" || chosen.size > 0 || mine;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-64">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={t("list.searchLabel")} placeholder={t("list.searchPlaceholder")} className="bg-card pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div role="group" aria-label={t("list.filterLabel")} className="flex flex-wrap gap-2">
          {CHIPS.map((chip) => (
            <ToggleChip key={chip} on={chosen.has(chip)} onClick={() => toggle(chip)}>
              {chip === "closed" ? t("list.closed") : t(`status.${chip}`)}
              <span className="text-xs text-muted-foreground">{count(chip)}</span>
            </ToggleChip>
          ))}
          <ToggleChip on={mine} onClick={() => setMine((v) => !v)}>
            {t("list.mine")}
          </ToggleChip>
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t("list.emptyTitle")}
          description={rows.length === 0 ? t("list.emptyNone") : t("list.emptyText")}
          action={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setChosen(new Set());
                  setMine(false);
                }}
              >
                {t("list.clearFilters")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {sections
            .filter((s) => s.rows.length > 0)
            .map((s) => (
              <Panel key={s.key} title={t(`list.${s.key}`)} meta={s.rows.length}>
                <ul>
                  {s.rows.map((r) => (
                    <RequestRow key={r.id} r={r} />
                  ))}
                </ul>
              </Panel>
            ))}
          {past.length > 0 && (
            <Collapsible open={pastOpen} onOpenChange={setPastOpen}>
              <Panel
                title={t("list.sectionPast")}
                meta={past.length}
                action={
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label={pastOpen ? t("list.hidePast") : t("list.showPast")}>
                      <ChevronDown aria-hidden className={cn("transition-transform", pastOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                }
              >
                <CollapsibleContent>
                  <ul>
                    {past.map((r) => (
                      <RequestRow key={r.id} r={r} />
                    ))}
                  </ul>
                </CollapsibleContent>
              </Panel>
            </Collapsible>
          )}
        </div>
      )}
    </>
  );
}
