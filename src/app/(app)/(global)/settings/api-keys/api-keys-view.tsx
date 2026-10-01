"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { ApiKeyManager, type ApiKeyItem } from "@/components/api-key-manager";
import { useNow } from "@/components/clock";
import { Page, PageHeader } from "@/components/page";
import { formatDate, relativeAge } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** Keys expiring within this many milliseconds are highlighted. */
const SOON_MS = 7 * 86_400_000;

/**
 * The API keys page body: the user's keys with formatted dates and the form creating one.
 *
 * @param props.appUrl the app's public URL, shown in the environment lines of a new key
 */
export function ApiKeysView({ appUrl }: { appUrl: string }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.account.apiKeys.queryOptions());
  const now = useNow();
  const keys = data.map((k): ApiKeyItem => {
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
      lastUsed: k.lastRequest ? relativeAge(k.lastRequest.toISOString(), now) : "never",
      usage: k.usage,
      grace: k.graceUntil && k.graceUntil.getTime() > now.getTime() ? `expires in ${Math.ceil((k.graceUntil.getTime() - now.getTime()) / 3_600_000)} h` : null,
    };
  });
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Account" }]}
        title="API keys"
        description="Keys let the surf-roadmap plugin and other agents act as you over MCP and REST, in every project you belong to."
      />
      <ApiKeyManager keys={keys} appUrl={appUrl} />
    </Page>
  );
}
