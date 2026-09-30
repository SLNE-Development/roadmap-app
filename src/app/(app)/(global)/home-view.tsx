"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { relativeAge } from "@/lib/time";
import { useTRPC } from "@/trpc/client";
import { ProjectGrid, type ProjectCardItem } from "./project-grid";

/** Formats a count with the singular or plural noun: "1 project", "3 projects". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The home page body: the project cards with their state, or an empty state with project creation. */
export function HomeView() {
  const trpc = useTRPC();
  const { data: cards } = useSuspenseQuery(trpc.projects.cards.queryOptions());
  const projects = cards.map((p): ProjectCardItem => {
    const s = p.summary;
    const last = (s?.lastChange ?? p.createdAt).toISOString();
    return {
      slug: p.slug,
      name: p.name,
      description: p.description,
      role: p.role,
      systems: s?.systems ?? 0,
      blocked: s?.byCategory.blocked ?? 0,
      openQuestions: s?.openQuestions ?? 0,
      byCategory: s?.byCategory ?? {},
      lastActivity: last,
      lastActivityLabel: relativeAge(last),
    };
  });

  const blocked = projects.reduce((n, p) => n + p.blocked, 0);
  const open = projects.reduce((n, p) => n + p.openQuestions, 0);
  const summary = [
    plural(projects.length, "project", "projects"),
    plural(blocked, "blocked system", "blocked systems"),
    plural(open, "open question", "open questions"),
  ].join(" · ");

  if (projects.length === 0) {
    return (
      <Page>
        <PageHeader title="Projects" actions={<NewProjectDialog />} />
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description="Create one, or ask a project owner to add you."
          action={<NewProjectDialog />}
        />
      </Page>
    );
  }

  return (
    <Page>
      <ProjectGrid projects={projects} summary={summary} />
    </Page>
  );
}
