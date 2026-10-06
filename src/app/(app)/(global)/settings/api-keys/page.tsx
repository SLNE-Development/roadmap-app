import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ApiKeysView } from "./api-keys-view";

/** Page where users create and revoke API keys for MCP and REST, and disconnect apps signed in with OAuth. */
export default async function ApiKeysPage() {
  await Promise.all([prefetch(trpc.account.apiKeys.queryOptions()), prefetch(trpc.account.connectedApps.queryOptions())]);
  return (
    <HydrateClient>
      <ApiKeysView appUrl={(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")} />
    </HydrateClient>
  );
}
