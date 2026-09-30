"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { StructureManager } from "@/components/structure-manager";
import { useTRPC } from "@/trpc/client";

/**
 * The structure settings body: the project's domains with their system counts
 * and its phases, editable by editors and above.
 *
 * @param props.slug the project slug
 */
export function StructureView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: domains }, { data: phases }, { data: systems }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.structure.domains.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
    ],
  });
  return (
    <StructureManager
      projectSlug={slug}
      canEdit={detail.role !== "viewer"}
      domains={domains.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        systemCount: systems.filter((s) => s.domainId === d.id).length,
      }))}
      phases={phases.map((p) => ({ id: p.id, name: p.name, goal: p.goal, dependsOn: p.dependsOn }))}
    />
  );
}
