import { ApiKeyManager, type ApiKeyItem } from "@/components/api-key-manager";
import { Page, PageHeader } from "@/components/page";
import { listApiKeys } from "@/lib/ops/api-keys";
import { pageData } from "@/lib/page";
import { formatDate, relativeAge } from "@/lib/time";

/** Keys expiring within this many milliseconds are highlighted. */
const SOON_MS = 7 * 86_400_000;

/** Page where users create and revoke API keys for MCP and REST. */
export default async function ApiKeysPage() {
  const now = new Date();
  const keys = await pageData(async (db, actor) =>
    (await listApiKeys(db, actor)).map((k): ApiKeyItem => {
      const left = k.expiresAt ? k.expiresAt.getTime() - now.getTime() : null;
      const expiry = left === null ? "none" : left <= 0 ? "expired" : left <= SOON_MS ? "soon" : "later";
      const date = k.expiresAt ? formatDate(k.expiresAt.toISOString(), now) : "";
      return {
        id: k.id,
        name: k.name,
        start: k.start,
        created: formatDate(k.createdAt.toISOString(), now),
        expires: expiry === "none" ? "Never" : expiry === "expired" ? `Expired ${date}` : date,
        expiry,
        lastUsed: k.lastRequest ? relativeAge(k.lastRequest.toISOString(), now) : "Never",
      };
    }),
  );
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Account" }]}
        title="API keys"
        description="Keys let the surf-roadmap plugin and other agents act as you over MCP and REST, in every project you belong to."
      />
      <ApiKeyManager keys={keys} appUrl={(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")} />
    </Page>
  );
}
