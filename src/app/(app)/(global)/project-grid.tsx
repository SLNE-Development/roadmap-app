"use client";

import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CATEGORY_CLASS, RoleTag } from "@/components/chips";
import { useNow } from "@/components/clock";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { EmptyState, PageHeader } from "@/components/page";
import { ProjectMark } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColumnCategory } from "@/db/schema";
import type { ProjectHealth } from "@/lib/health";
import { healthReasonText } from "./health-reason";

/** A project card's data, computed on the server. */
export interface ProjectCardItem {
  slug: string;
  name: string;
  description: string;
  role: string;
  systems: number;
  blocked: number;
  openQuestions: number;
  byCategory: Partial<Record<ColumnCategory, number>>;
  /** ISO time of the latest change, for sorting. */
  lastActivity: string;
  health: ProjectHealth;
}

/** Order of the segments in a card's status bar: finished work first, planning last. */
const SEGMENT_ORDER: ColumnCategory[] = ["done", "review", "active", "todo", "blocked", "planning"];

/** Sort options of the grid. */
const SORTS = {
  recent: { item: "sortRecent", current: "sortCurrentRecent" },
  name: { item: "sortName", current: "sortCurrentName" },
  health: { item: "sortHealth", current: "sortCurrentHealth" },
} as const;
type SortKey = keyof typeof SORTS;

/** The badge of each health status (`home` message key and colours); `empty` has none. */
const HEALTH_BADGE = {
  "on-track": { label: "healthOnTrack", className: "bg-cat-done-soft text-cat-done" },
  "at-risk": { label: "healthAtRisk", className: "bg-cat-review-soft text-cat-review" },
  stalled: { label: "healthStalled", className: "bg-cat-blocked-soft text-cat-blocked" },
} as const;

/** Sort position of each health status: stalled first, empty last. */
const HEALTH_RANK: Record<ProjectHealth["status"], number> = { stalled: 0, "at-risk": 1, "on-track": 2, empty: 3 };

/** The health badge with the reasons in a tooltip; nothing for a project without systems. */
function HealthBadge({ health }: { health: ProjectHealth }) {
  const t = useTranslations("home");
  if (health.status === "empty") return null;
  const badge = HEALTH_BADGE[health.status];
  const label = t(badge.label);
  const { className } = badge;
  const reasons = health.reasons.map((r) => healthReasonText(t, r));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={t("healthAria", { label, reasons: reasons.join(" ") })}
          className={`px-1.5 py-0.5 text-[11px] font-semibold ${className}`}
        >
          {label}
        </span>
      </TooltipTrigger>
      {health.reasons.length > 0 && (
        <TooltipContent>
          <ul className="list-disc pl-3.5">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/** A segmented bar with one segment per category, sized by its number of systems. */
function StatusBar({ byCategory, total }: { byCategory: ProjectCardItem["byCategory"]; total: number }) {
  const t = useTranslations("home");
  const categories = useTranslations("enums.category");
  if (total === 0) return <span aria-hidden className="flex h-1.5 bg-track" />;
  const label = SEGMENT_ORDER.filter((c) => byCategory[c])
    .map((c) => t("statusSegment", { count: byCategory[c] ?? 0, category: categories(c) }))
    .join(", ");
  return (
    <span role="img" aria-label={label} className="flex h-1.5 gap-0.5">
      {SEGMENT_ORDER.map((c) =>
        byCategory[c] ? <span key={c} className={CATEGORY_CLASS[c]} style={{ flexGrow: byCategory[c] }} /> : null,
      )}
    </span>
  );
}

/** One project as a card linking to its overview. */
function ProjectCard({ p }: { p: ProjectCardItem }) {
  const t = useTranslations("home");
  const format = useFormatter();
  const now = useNow();
  return (
    <Link
      href={`/p/${p.slug}`}
      className="flex flex-col gap-3 border bg-card px-[18px] py-4 outline-none transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-2.5">
        <ProjectMark name={p.name} slug={p.slug} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.name}</span>
        <HealthBadge health={p.health} />
        <RoleTag role={p.role} />
      </span>
      <span className="line-clamp-2 h-[39px] text-[13px] leading-normal text-fg-2">{p.description}</span>
      <StatusBar byCategory={p.byCategory} total={p.systems} />
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
        <span>{t("systemCount", { count: p.systems })}</span>
        {p.blocked > 0 && <span className="font-semibold text-cat-blocked">{t("blockedCount", { count: p.blocked })}</span>}
        <span>{t("openQuestionCount", { count: p.openQuestions })}</span>
        <span className="ml-auto">{format.relativeTime(new Date(p.lastActivity), now)}</span>
      </span>
    </Link>
  );
}

/** The home header with search and sort, and the grid of project cards ending in a "New project" tile. */
export function ProjectGrid({ projects, summary }: { projects: ProjectCardItem[]; summary: string }) {
  const t = useTranslations("home");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? projects.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)) : projects;
    return [...matches].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (sort === "health" ? HEALTH_RANK[a.health.status] - HEALTH_RANK[b.health.status] : 0) ||
          b.lastActivity.localeCompare(a.lastActivity),
    );
  }, [projects, query, sort]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={summary}
        actions={
          <>
            <label className="relative w-full sm:w-60">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label={t("findProject")}
                placeholder={t("findProject")}
                className="bg-card pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="text-fg-2">
                  {t(SORTS[sort].current)}
                  <ChevronDown aria-hidden className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  {(Object.keys(SORTS) as SortKey[]).map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {t(SORTS[k].item)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <NewProjectDialog />
          </>
        }
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={t("noMatchTitle")}
          description={t("noMatchText", { query: query.trim() })}
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              {t("clearSearch")}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <li key={p.slug} className="flex flex-col [&>a]:flex-1">
              <ProjectCard p={p} />
            </li>
          ))}
          <li className="flex flex-col">
            <NewProjectDialog variant="tile" />
          </li>
        </ul>
      )}
    </>
  );
}
