import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { AgentsView, type RunState } from "./agents-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The project's agent runs: live, today's and failed ones, and a run's call
 * timeline in a sheet opened by `?run=`.
 */
export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const state: RunState = one(sp.state) === "live" || one(sp.state) === "failed" ? (one(sp.state) as RunState) : "recent";
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.agents.runs.queryOptions({ project: slug, state: "live" }),
    trpc.agents.runs.queryOptions({ project: slug, state: "recent" }),
    trpc.agents.runs.queryOptions({ project: slug, state: "failed" }),
  );
  return (
    <HydrateClient>
      <AgentsView slug={slug} state={state} runId={one(sp.run)} />
    </HydrateClient>
  );
}
