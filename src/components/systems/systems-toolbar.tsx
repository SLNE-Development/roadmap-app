"use client";

import { ChevronDown, LayoutGrid, Search, Table2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One choice of a filter chip. */
export interface FilterOption {
  value: string;
  label: string;
}

/** A filter chip: the query key it sets, its name and its choices. */
export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
}

/** Grouping modes of the systems list. */
const GROUPS = [
  { value: "domain", label: "Domain" },
  { value: "phase", label: "Phase" },
  { value: "board", label: "Board" },
  { value: "none", label: "None" },
];

/**
 * Search, filter chips, grouping and view toggle of the systems list. Every
 * change replaces the URL query at once; the server page re-renders from it.
 *
 * @param props.current the current query values (empty keys omitted)
 * @param props.shown how many systems match
 * @param props.total how many systems the project has
 */
export function SystemsToolbar({
  filters,
  current,
  shown,
  total,
}: {
  filters: FilterDef[];
  current: Record<string, string>;
  shown: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(current.q ?? "");

  /** Replaces the URL with `patch` applied; empty values remove their key. */
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // The URL is the source of truth: Clear filters and back/forward reset the input.
  const [seenQ, setSeenQ] = useState(current.q ?? "");
  if ((current.q ?? "") !== seenQ) {
    setSeenQ(current.q ?? "");
    setQuery(current.q ?? "");
  }

  useEffect(() => {
    if (query.trim() === (current.q ?? "")) return;
    const timer = setTimeout(() => update({ q: query.trim() }), 250);
    return () => clearTimeout(timer);
    // `update` closes over `current`; re-running on query changes is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const group = current.group ?? "domain";
  const view = current.view === "cards" ? "cards" : "table";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-8 w-full items-center gap-2 border bg-card px-2.5 text-muted-foreground focus-within:border-ring sm:w-[260px]">
        <Search aria-hidden className="size-3.5 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles and summaries"
          aria-label="Search systems"
          className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {filters.map((f) => (
        <FilterChip key={f.key} def={f} value={current[f.key] ?? ""} onChange={(v) => update({ [f.key]: v })} />
      ))}
      <span className="hidden flex-1 sm:block" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 border bg-card px-2.5 text-[13px] text-fg-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Group: {GROUPS.find((g) => g.value === group)?.label.toLowerCase() ?? "domain"}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={group} onValueChange={(v) => update({ group: v === "domain" ? "" : v })}>
            {GROUPS.map((g) => (
              <DropdownMenuRadioItem key={g.value} value={g.value}>
                {g.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div role="group" aria-label="View" className="flex border bg-card p-[3px]">
        <ViewButton label="Table view" active={view === "table"} onClick={() => update({ view: "" })}>
          <Table2 aria-hidden className="size-[15px]" />
        </ViewButton>
        <ViewButton label="Card view" active={view === "cards"} onClick={() => update({ view: "cards" })}>
          <LayoutGrid aria-hidden className="size-[15px]" />
        </ViewButton>
      </div>
      <span className="text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">
        {shown} of {total}
      </span>
    </div>
  );
}

/** One button of the table/card view toggle. */
function ViewButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-[26px] w-[30px] items-center justify-center focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A filter chip: dashed with a chevron when unset, brand-soft with the chosen
 * value and a clear button when set.
 */
function FilterChip({ def, value, onChange }: { def: FilterDef; value: string; onChange: (value: string) => void }) {
  const chosen = def.options.find((o) => o.value === value);
  return (
    <div
      className={cn(
        "flex h-8 items-center text-[13px]",
        chosen ? "border border-primary bg-brand-soft font-medium text-brand-strong" : "border border-dashed text-fg-2",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-full items-center gap-1.5 px-2.5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {chosen ? `${def.label}: ${chosen.label}` : def.label}
            {!chosen && <ChevronDown aria-hidden className="size-3" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-auto min-w-44">
          <DropdownMenuLabel>{def.label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            <DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>
            {def.options.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {chosen && (
        <button
          type="button"
          aria-label={`Clear ${def.label.toLowerCase()} filter`}
          onClick={() => onChange("")}
          className="flex h-full items-center pr-2 pl-0.5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
    </div>
  );
}
