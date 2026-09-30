"use client";

import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORY_CLASS, CATEGORY_LABEL, RoleTag } from "@/components/chips";
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
import type { ColumnCategory } from "@/db/schema";

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
  /** The latest change as "2 h ago", rendered on the server so both sides agree. */
  lastActivityLabel: string;
}

/** Order of the segments in a card's status bar: finished work first, planning last. */
const SEGMENT_ORDER: ColumnCategory[] = ["done", "review", "active", "todo", "blocked", "planning"];

/** Sort options of the grid. */
const SORTS = { recent: "Recent activity", name: "Name" } as const;
type SortKey = keyof typeof SORTS;

/** A segmented bar with one segment per category, sized by its number of systems. */
function StatusBar({ byCategory, total }: { byCategory: ProjectCardItem["byCategory"]; total: number }) {
  if (total === 0) return <span aria-hidden className="flex h-1.5 bg-track" />;
  const label = SEGMENT_ORDER.filter((c) => byCategory[c])
    .map((c) => `${byCategory[c]} ${CATEGORY_LABEL[c]}`)
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
  return (
    <Link
      href={`/p/${p.slug}`}
      className="flex flex-col gap-3 border bg-card px-[18px] py-4 outline-none transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-2.5">
        <ProjectMark name={p.name} slug={p.slug} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.name}</span>
        <RoleTag role={p.role} />
      </span>
      <span className="line-clamp-2 h-[39px] text-[13px] leading-normal text-fg-2">{p.description}</span>
      <StatusBar byCategory={p.byCategory} total={p.systems} />
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
        <span>{p.systems === 1 ? "1 system" : `${p.systems} systems`}</span>
        {p.blocked > 0 && <span className="font-semibold text-cat-blocked">{p.blocked} blocked</span>}
        <span>{p.openQuestions === 1 ? "1 open question" : `${p.openQuestions} open questions`}</span>
        <span className="ml-auto">{p.lastActivityLabel}</span>
      </span>
    </Link>
  );
}

/** The home header with search and sort, and the grid of project cards ending in a "New project" tile. */
export function ProjectGrid({ projects, summary }: { projects: ProjectCardItem[]; summary: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? projects.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)) : projects;
    return [...matches].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.lastActivity.localeCompare(a.lastActivity),
    );
  }, [projects, query, sort]);

  return (
    <>
      <PageHeader
        title="Projects"
        description={summary}
        actions={
          <>
            <label className="relative w-full sm:w-60">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Find a project"
                placeholder="Find a project"
                className="bg-card pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="text-fg-2">
                  Sort: {SORTS[sort].toLowerCase()}
                  <ChevronDown aria-hidden className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  {(Object.keys(SORTS) as SortKey[]).map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {SORTS[k]}
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
          title="No matching projects"
          description={`Nothing matches “${query.trim()}”. Try another name.`}
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
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
