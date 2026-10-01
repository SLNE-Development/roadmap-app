import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { GitHubSettingsView } from "./github-settings-view";

/** The project's linked GitHub repositories. Owners (or admins, by the instance's link policy) link them; others read. */
export default async function SettingsGitHubPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.github.repos.queryOptions({ project: slug }),
    trpc.github.linkStatus.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <GitHubSettingsView slug={slug} />
    </HydrateClient>
  );
}
