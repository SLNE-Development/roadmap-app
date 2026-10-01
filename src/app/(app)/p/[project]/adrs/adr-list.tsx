"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { UnderlineTabs, type UrlTab } from "@/components/activity/url-tabs";
import { AdrStatusChip, Tag } from "@/components/chips";
import { EmptyState } from "@/components/page";
import type { AdrStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

/** An ADR row as the decisions page passes it in. */
export interface AdrRow {
  number: number;
  label: string;
  title: string;
  status: AdrStatus;
  systems: string[];
  note: string | null;
  date: string;
}

/** True when the trimmed, lower-cased query is in the title or label, is the number, or reads as `ADR-3` or `adr0003`. */
export function adrMatches(row: { title: string; label: string; number: number }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.title.toLowerCase().includes(q) || row.label.includes(q) || q === String(row.number)) return true;
  const m = /^adr-?0*(\d+)$/.exec(q);
  return m !== null && Number(m[1]) === row.number;
}

/** The status tabs, a search box filtering titles and numbers, and the list of decisions. */
export function AdrList({ projectSlug, tabs, rows }: { projectSlug: string; tabs: UrlTab[]; rows: AdrRow[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => adrMatches(r, needle)) : rows;
  return (
    <>
      <UnderlineTabs label="Status" tabs={tabs}>
        <label className="flex h-[30px] w-full items-center gap-2 border bg-card px-2.5 text-muted-foreground focus-within:border-ring sm:w-[220px]">
          <Search aria-hidden className="size-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decisions"
            aria-label="Search decisions"
            className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </UnderlineTabs>
      {shown.length === 0 ? (
        <EmptyState title="No matching decisions" description={needle ? `Nothing here has “${query.trim()}” in its title or number.` : "No decisions have this status."} />
      ) : (
        <ol className="flex flex-col border bg-card">
          {shown.map((a) => (
            <li key={a.number} className="border-b last:border-b-0">
              <Link
                href={`/p/${projectSlug}/adrs/${a.number}`}
                data-nav-item
                className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted sm:grid-cols-[52px_minmax(0,1fr)_110px_80px] sm:px-[18px]"
              >
                <span className="font-mono text-[12.5px] text-muted-foreground">{a.label}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className={cn("text-sm font-semibold", a.status === "superseded" && "text-muted-foreground")}>{a.title}</span>
                  {(a.systems.length > 0 || a.note) && (
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {a.systems.map((s) => (
                        <Tag key={s} className="px-1.5 py-px font-normal">
                          {s}
                        </Tag>
                      ))}
                      {a.note && <span>{a.note}</span>}
                    </span>
                  )}
                </span>
                <span className="col-start-2 flex items-center justify-between gap-3 sm:col-start-auto sm:contents">
                  <span>
                    <AdrStatusChip status={a.status} />
                  </span>
                  <span className="text-right text-[12.5px] text-muted-foreground">{a.date}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
