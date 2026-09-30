import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ApiKeysView } from "./api-keys-view";

/** Page where users create and revoke API keys for MCP and REST. */
export default async function ApiKeysPage() {
  await prefetch(trpc.account.apiKeys.queryOptions());
  return (
    <HydrateClient>
      <ApiKeysView appUrl={(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")} />
    </HydrateClient>
  );
}
