"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { ProjectSettings } from "@/components/project-settings";
import { useTRPC } from "@/trpc/client";

/**
 * The General settings page body: the project's name, description and repository.
 *
 * @param props.slug the project slug
 */
export function SettingsGeneralView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const {
    data: { project, role },
  } = useSuspenseQuery(trpc.projects.get.queryOptions({ project: slug }));
  return (
    <ProjectSettings
      slug={slug}
      name={project.name}
      description={project.description}
      repoUrl={project.repoUrl}
      canEdit={role === "owner" || role === "admin"}
    />
  );
}
