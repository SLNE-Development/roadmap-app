import { notFound } from "next/navigation";
import { AUTH_EVENT_KINDS, type AuthEventKind } from "@/db/schema";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { AuditView, type AuditTab } from "./audit-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Admin audit page: auth events (`?kind=`, `?user=`), failed agent tool calls and API key usage,
 * one tab each (`?tab=`); non-admins get a 404.
 */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [me] = await prefetch(trpc.account.me.queryOptions());
  if (!me.isAdmin) notFound();
  await prefetch(trpc.account.accounts.queryOptions());
  const sp = await searchParams;
  const tab: AuditTab = one(sp.tab) === "failed" || one(sp.tab) === "keys" ? (one(sp.tab) as AuditTab) : "events";
  const kind = (AUTH_EVENT_KINDS as readonly string[]).includes(one(sp.kind) ?? "") ? (one(sp.kind) as AuthEventKind) : undefined;
  return (
    <HydrateClient>
      <AuditView tab={tab} kind={kind} userId={one(sp.user)} />
    </HydrateClient>
  );
}
