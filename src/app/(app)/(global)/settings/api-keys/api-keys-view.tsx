"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { ApiKeyManager, type ApiKeyItem } from "@/components/api-key-manager";
import { useShortDate } from "@/components/account/short-date";
import { useNow } from "@/components/clock";
import { Page, PageHeader } from "@/components/page";
import { useTRPC } from "@/trpc/client";

/** Keys expiring within this many milliseconds are highlighted. */
const SOON_MS = 7 * 86_400_000;

/**
 * The API keys page body: the user's keys with formatted dates and the form creating one.
 *
 * @param props.appUrl the app's public URL, shown in the environment lines of a new key
 */
export function ApiKeysView({ appUrl }: { appUrl: string }) {
  const t = useTranslations("account.apiKeys");
  const format = useFormatter();
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.account.apiKeys.queryOptions());
  const now = useNow();
  const shortDate = useShortDate(now);
  const keys = data.map((k): ApiKeyItem => {
    const left = k.expiresAt ? k.expiresAt.getTime() - now.getTime() : null;
    const expiry = left === null ? "none" : left <= 0 ? "expired" : left <= SOON_MS ? "soon" : "later";
    const date = k.expiresAt ? shortDate(k.expiresAt) : "";
    return {
      id: k.id,
      name: k.name,
      start: k.start,
      created: shortDate(k.createdAt),
      expires: expiry === "none" ? t("never") : expiry === "expired" ? t("expired", { date }) : date,
      expiry,
      lastUsed: k.lastRequest ? format.relativeTime(k.lastRequest, now) : t("neverUsed"),
      usage: k.usage,
      grace: k.graceUntil && k.graceUntil.getTime() > now.getTime() ? t("graceLeft", { hours: Math.ceil((k.graceUntil.getTime() - now.getTime()) / 3_600_000) }) : null,
    };
  });
  return (
    <Page width="medium">
      <PageHeader crumbs={[{ label: t("crumb") }]} title={t("title")} description={t("description")} />
      <ApiKeyManager keys={keys} appUrl={appUrl} />
    </Page>
  );
}
