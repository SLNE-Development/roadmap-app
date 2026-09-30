"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { AppShell } from "./app-shell";

/**
 * Shell of the pages outside a project (home, API keys, accounts): the sidebar
 * lists the projects instead of a project's sections. Reads the queries its
 * layout prefetched.
 *
 * @param props.children the page content
 */
export function GlobalShell({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const [{ data: me }, { data: projects }] = useSuspenseQueries({
    queries: [trpc.account.me.queryOptions(), trpc.projects.list.queryOptions()],
  });
  return (
    <AppShell actor={{ name: me.name, isAdmin: me.isAdmin }} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}>
      {children}
    </AppShell>
  );
}

/**
 * Shell of every project page: the sidebar shows the project's boards with
 * system counts, section counts and members. Counts follow every change,
 * since mutations refetch these queries.
 *
 * @param props.slug the project slug
 * @param props.children the page content
 */
export function ProjectShell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const trpc = useTRPC();
  const [{ data: me }, { data: projects }, { data: detail }, { data: nav }] = useSuspenseQueries({
    queries: [
      trpc.account.me.queryOptions(),
      trpc.projects.list.queryOptions(),
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.projects.nav.queryOptions({ project: slug }),
    ],
  });
  const systems = nav.systems;
  const project = {
    slug,
    name: detail.project.name,
    role: detail.role,
    memberCount: nav.memberCount,
    boards: detail.boards.map((b) => ({ slug: b.slug, name: b.name, count: systems.filter((s) => s.boardSlug === b.slug).length })),
    counts: { systems: systems.length, adrs: nav.adrCount, openQuestions: nav.openQuestionCount },
  };
  return (
    <AppShell
      actor={{ name: me.name, isAdmin: me.isAdmin }}
      projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
      project={project}
      systems={systems.map((s) => ({ slug: s.slug, title: s.title }))}
    >
      {children}
    </AppShell>
  );
}
