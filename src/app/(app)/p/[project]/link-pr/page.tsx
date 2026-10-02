import { notFound } from "next/navigation";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { LinkPrView } from "./link-pr-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Where a person picks the task a pull request belongs to: the GitHub App's comment links here as
 * `/p/<slug>/link-pr?repo=<id>&pr=<number>`. Editors and above; a missing or invalid parameter is a 404.
 */
export default async function LinkPrPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const repoId = one(sp.repo);
  const prParam = one(sp.pr);
  const number = prParam && /^\d{1,9}$/.test(prParam) ? Number(prParam) : 0;
  if (!repoId || number < 1) notFound();
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.github.pullRequestContext.queryOptions({ project: slug, repoId, number }),
  );
  return (
    <HydrateClient>
      <LinkPrView slug={slug} repoId={repoId} number={number} />
    </HydrateClient>
  );
}
