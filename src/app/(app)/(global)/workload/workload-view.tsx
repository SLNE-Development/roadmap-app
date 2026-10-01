"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { withQuery } from "@/components/activity/url-tabs";
import { FilterChip } from "@/components/filter-chip";
import { EmptyState, Page, PageHeader, ProgressBar } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { overloaded } from "@/lib/workload";
import { plural } from "@/lib/text";
import { useTRPC } from "@/trpc/client";

const HEAD = "px-3 py-2";

/**
 * The workload page body: a table of people with their systems, blocked work,
 * tasks in progress and open points, each row expanding to per-project numbers.
 *
 * @param props.project the project slug the page is narrowed to, validated by the page
 */
export function WorkloadView({ project }: { project: string | undefined }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [{ data: rows }, { data: projects }] = useSuspenseQueries({
    queries: [trpc.account.workload.queryOptions({ project }), trpc.account.workloadProjects.queryOptions()],
  });
  const max = Math.max(0, ...rows.map((r) => r.openPoints));
  const over = overloaded(rows);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Account" }]}
        title="Workload"
        description="What each person owns and has open across the projects you share. Points add up the estimates of their unfinished tasks."
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Project"
          options={projects.map((p) => ({ value: p.slug, label: p.name }))}
          value={project ?? ""}
          onChange={(value) => startTransition(() => router.replace(withQuery("/workload", {}, { project: value }), { scroll: false }))}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Users />} title="No one to show yet" description="Workload lists the members of the projects you belong to." />
      ) : (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b bg-secondary text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <th scope="col" className={HEAD}>
                  Person
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Systems
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Blocked
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Doing
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Points
                </th>
                <th scope="col" className={`${HEAD} w-40`}>
                  <span className="sr-only">Points compared with the busiest person</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = open.has(r.userId);
                return (
                  <Fragment key={r.userId}>
                    <tr className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} projects of ${r.name}`}
                            onClick={() => toggle(r.userId)}
                            className="text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          >
                            <ChevronRight aria-hidden className={expanded ? "size-3.5 rotate-90" : "size-3.5"} />
                          </button>
                          <PersonAvatar name={r.name} size="sm" />
                          <span className="font-medium">{r.name}</span>
                          {over.has(r.userId) && <span className="bg-cat-review-soft px-1.5 py-px text-[11px] font-semibold text-cat-review">Overloaded</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.systemsOwned}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.systemsBlocked + r.tasksBlocked}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.tasksDoing}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.openPoints}</td>
                      <td className="px-3 py-2">
                        <ProgressBar value={r.openPoints} total={max} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-secondary/40 last:border-b-0">
                        <td colSpan={6} className="px-3 py-2 pl-12">
                          {r.projects.length === 0 ? (
                            <span className="text-muted-foreground">Nothing owned in these projects.</span>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {r.projects.map((p) => (
                                <li key={p.slug}>
                                  <Link href={`/p/${p.slug}/systems?owner=${r.userId}`} className="hover:underline">
                                    <span className="font-medium">{p.name}</span>
                                    <span className="text-fg-2">
                                      {" "}
                                      · {plural(p.systems, "system")}, {p.tasksDoing} doing
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
