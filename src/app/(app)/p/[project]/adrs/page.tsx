import { ADR_STATUSES } from "@/db/schema";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { AdrsView } from "./adrs-view";

/**
 * The project's decision records, newest first, with status tabs (`?status=`)
 * and a title search. Agents propose decisions over MCP, so there is no create button.
 */
export default async function AdrsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const raw = (await searchParams).status;
  const status = ADR_STATUSES.find((s) => s === raw);
  await prefetch(
    trpc.adrs.list.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
    trpc.projects.get.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <AdrsView slug={slug} status={status} />
    </HydrateClient>
  );
}
