"use client";

import { ChevronDown, LayoutGrid, Search, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { FilterChip, type FilterOption } from "@/components/filter-chip";
import { SaveViewButton } from "@/components/save-view-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeChips, suggestViewName } from "@/lib/view-name";
import { cn } from "@/lib/utils";

/** A filter chip: the query key it sets, its name and its choices. */
export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
}

/** Grouping modes of the systems list; each is also the key of its label in `systems.group`. */
const GROUPS = ["domain", "phase", "board", "none"] as const;

/**
 * Whether an incoming `q` is the one this toolbar just pushed, so the input,
 * which may already hold newer keystrokes, must not be reset to it.
 *
 * @param incoming the `q` now in the URL
 * @param pushed the last `q` the toolbar pushed, if any
 */
export function isOwnPush(incoming: string, pushed: string | undefined): boolean {
  return pushed !== undefined && incoming === pushed;
}

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
  const t = useTranslations("systems");
  const tb = useTranslations("board.saveView");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(current.q ?? "");
  // The last `q` this toolbar pushed to the URL; its arrival must not reset the input.
  const [pushedQ, setPushedQ] = useState<string | undefined>(undefined);

  /** Replaces the URL with `patch` applied; empty values remove their key. */
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if ("q" in patch) setPushedQ(patch.q);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // The URL is the source of truth: Clear filters and back/forward reset the input.
  const [seenQ, setSeenQ] = useState(current.q ?? "");
  if ((current.q ?? "") !== seenQ) {
    setSeenQ(current.q ?? "");
    if (!isOwnPush(current.q ?? "", pushedQ)) {
      setQuery(current.q ?? "");
      setPushedQ(undefined);
    }
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
  const filtered = Boolean(current.q || filters.some((f) => current[f.key]));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-8 w-full items-center gap-2 border bg-card px-2.5 text-muted-foreground focus-within:border-ring sm:w-[260px]">
        <Search aria-hidden className="size-3.5 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("toolbar.searchPlaceholder")}
          aria-label={t("toolbar.search")}
          className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {filters.map((f) => (
        <FilterChip key={f.key} label={f.label} options={f.options} value={current[f.key] ?? ""} onChange={(v) => update({ [f.key]: v })} />
      ))}
      {filtered && (
        <SaveViewButton
          path={pathname}
          query={new URLSearchParams(current).toString()}
          suggestedName={suggestViewName(t("title"), activeChips(filters, current, tb("search")))}
        />
      )}
      <span className="hidden flex-1 sm:block" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 border bg-card px-2.5 text-[13px] text-fg-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("group.label", { group: t(`group.${GROUPS.find((g) => g === group) ?? "domain"}`) })}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          <DropdownMenuLabel>{t("group.by")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={group} onValueChange={(v) => update({ group: v === "domain" ? "" : v })}>
            {GROUPS.map((g) => (
              <DropdownMenuRadioItem key={g} value={g}>
                {t(`group.${g}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div role="group" aria-label={t("toolbar.viewGroup")} className="flex border bg-card p-[3px]">
        <ViewButton label={t("toolbar.table")} active={view === "table"} onClick={() => update({ view: "" })}>
          <Table2 aria-hidden className="size-[15px]" />
        </ViewButton>
        <ViewButton label={t("toolbar.cards")} active={view === "cards"} onClick={() => update({ view: "cards" })}>
          <LayoutGrid aria-hidden className="size-[15px]" />
        </ViewButton>
      </div>
      <span className="text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">
        {t("toolbar.shownOf", { shown, total })}
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
