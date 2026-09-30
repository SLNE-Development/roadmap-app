import { ApiKeyManager } from "@/components/api-key-manager";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { listApiKeys } from "@/lib/ops/api-keys";

/** Page where users create and revoke API keys for MCP and REST. */
export default async function ApiKeysPage() {
  const actor = await requireActor();
  const keys = (await listApiKeys(getDb(), actor)).map((k) => ({
    ...k,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt?.toISOString() ?? null,
    lastRequest: k.lastRequest?.toISOString() ?? null,
  }));
  return (
    <div className="mx-auto max-w-7xl py-6">
      <div className="flex max-w-5xl flex-col gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Settings</p>
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            A key acts as you in every project you belong to. Set the two lines shown after creating a key as environment
            variables for the surf-roadmap plugin.
          </p>
        </div>
        <ApiKeyManager keys={keys} appUrl={process.env.BETTER_AUTH_URL ?? ""} />
      </div>
    </div>
  );
}
