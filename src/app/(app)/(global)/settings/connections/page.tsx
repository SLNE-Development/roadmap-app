import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ConnectionsView } from "./connections-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Page where users link their GitHub login. `?linked=1` and `?error=` come back from the OAuth callback. */
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await prefetch(trpc.github.account.queryOptions());
  const sp = await searchParams;
  return (
    <HydrateClient>
      <ConnectionsView linked={one(sp.linked) === "1"} error={one(sp.error)} />
    </HydrateClient>
  );
}
