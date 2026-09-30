import { GlobalShell } from "@/components/shell/shells";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

/**
 * Shell of the pages outside a project (home, API keys, accounts): prefetches
 * the user and their projects for the sidebar.
 *
 * @param props.children the page content
 */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  await prefetch(trpc.account.me.queryOptions(), trpc.projects.list.queryOptions());
  return (
    <HydrateClient>
      <GlobalShell>{children}</GlobalShell>
    </HydrateClient>
  );
}
