import { notFound } from "next/navigation";
import { defaultAppName } from "@/lib/github/manifest";
import { siteUrl } from "@/lib/site";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { GitHubAdminView } from "./github-admin-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Admin page of the GitHub App: creating or connecting it, its installations, settings and webhook health.
 * `?created=1`, `?requested=1` and `?error=` come back from GitHub's redirects. Non-admins get a 404.
 */
export default async function AdminGitHubPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [me] = await prefetch(trpc.account.me.queryOptions());
  if (!me.isAdmin) notFound();
  const [app] = await prefetch(trpc.github.app.queryOptions());
  if (app) await prefetch(trpc.github.installations.queryOptions(), trpc.github.installRequests.queryOptions());
  const sp = await searchParams;
  const origin = siteUrl().origin;
  return (
    <HydrateClient>
      <GitHubAdminView
        defaultName={defaultAppName(siteUrl())}
        urls={{ webhook: `${origin}/api/github/app`, setup: `${origin}/api/github/setup`, oauth: `${origin}/api/github/oauth/callback` }}
        created={one(sp.created) === "1"}
        requested={one(sp.requested) === "1"}
        error={one(sp.error)}
      />
    </HydrateClient>
  );
}
