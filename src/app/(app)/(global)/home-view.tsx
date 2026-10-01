"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { ProjectMark } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { relativeAge } from "@/lib/time";
import { useTRPC } from "@/trpc/client";
import { ProjectGrid, type ProjectCardItem } from "./project-grid";

/** Formats a count with the singular or plural noun: "1 project", "3 projects". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** An archived project in the home list. */
interface ArchivedProjectItem {
  slug: string;
  name: string;
  role: string;
}

/** The "Archived (N)" toggle under the grid; open, it lists the archived projects greyed, with Restore for owners. */
function ArchivedProjects({ projects }: { projects: ArchivedProjectItem[] }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const restore = useMutation(trpc.projects.restore.mutationOptions({ onSuccess: () => toast.success("Project restored") }));
  if (projects.length === 0) return null;
  return (
    <section aria-label="Archived projects" className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        className="self-start text-[13px] font-medium text-brand-strong outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setOpen((o) => !o)}
      >
        Archived ({projects.length})
      </button>
      {open && (
        <ul className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.slug} className="flex items-center gap-2.5 border bg-card px-[18px] py-3">
              <span className="flex min-w-0 flex-1 items-center gap-2.5 opacity-60 grayscale">
                <ProjectMark name={p.name} slug={p.slug} />
                <Link href={`/p/${p.slug}`} className="min-w-0 truncate text-[15px] font-semibold hover:underline">
                  {p.name}
                </Link>
              </span>
              {(p.role === "owner" || p.role === "admin") && (
                <Button size="sm" variant="outline" aria-label={`Restore ${p.name}`} disabled={restore.isPending} onClick={() => restore.mutate({ project: p.slug })}>
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The home page body: the project cards with their state, or an empty state with project creation, and the archived projects. */
export function HomeView() {
  const trpc = useTRPC();
  const [{ data: cards }, { data: archived }] = useSuspenseQueries({
    queries: [trpc.projects.cards.queryOptions(), trpc.projects.list.queryOptions({ archived: "only" })],
  });
  const archivedItems = archived.map((p) => ({ slug: p.slug, name: p.name, role: p.role }));
  const now = useNow();
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
      lastActivityLabel: relativeAge(last, now),
      health: s?.health ?? { status: "empty", reasons: [] },
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
        <ArchivedProjects projects={archivedItems} />
      </Page>
    );
  }

  return (
    <Page>
      <ProjectGrid projects={projects} summary={summary} />
      <ArchivedProjects projects={archivedItems} />
    </Page>
  );
}
