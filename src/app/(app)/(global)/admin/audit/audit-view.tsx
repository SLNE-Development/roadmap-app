"use client";

import { useInfiniteQuery, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { UnderlineTabs, withQuery } from "@/components/activity/url-tabs";
import { useNow } from "@/components/clock";
import { EmptyState, Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AUTH_EVENT_KINDS, type AuthEventKind } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/** The tab of the audit page. */
export type AuditTab = "events" | "failed" | "keys";

const PATH = "/admin/audit";

/** Kinds shown in red: refusals and key failures. */
const WARNING_KINDS: ReadonlySet<AuthEventKind> = new Set(["sign-in-refused", "key-rejected", "key-rate-limited"]);

const head = "text-xs font-semibold text-muted-foreground";

/** Returns a formatter of timestamps as "12 Sep 09:05", with the year when it is not the current one. */
function useStamp(now: Date): (at: Date) => string {
  const format = useFormatter();
  return (at) =>
    format.dateTime(at, {
      day: "numeric",
      month: "short",
      ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
      hour: "2-digit",
      minute: "2-digit",
    });
}

/** The Events tab: kind and user filters, the newest events and "Load more". */
function EventsTab({ kind, userId }: { kind: AuthEventKind | undefined; userId: string | undefined }) {
  const t = useTranslations("admin.audit");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const router = useRouter();
  const now = useNow();
  const stamp = useStamp(now);
  const { data: accounts } = useSuspenseQuery(trpc.account.accounts.queryOptions());
  const users = accounts.filter((a): a is typeof a & { userId: string } => a.userId !== null);
  const events = useInfiniteQuery(
    trpc.admin.auditEvents.infiniteQueryOptions({ kind, userId }, { getNextPageParam: (page) => page.nextBefore }),
  );
  const filter = (patch: Record<string, string | null>) =>
    router.replace(withQuery(PATH, { kind, user: userId }, patch), { scroll: false });
  const rows = events.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-kind">{t("kind")}</Label>
          <NativeSelect id="audit-kind" size="sm" value={kind ?? ""} onChange={(e) => filter({ kind: e.target.value || null })}>
            <NativeSelectOption value="">{t("allKinds")}</NativeSelectOption>
            {AUTH_EVENT_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {t(`kinds.${k}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-user">{t("user")}</Label>
          <NativeSelect id="audit-user" size="sm" value={userId ?? ""} onChange={(e) => filter({ user: e.target.value || null })}>
            <NativeSelectOption value="">{t("everyone")}</NativeSelectOption>
            {users.map((u) => (
              <NativeSelectOption key={u.userId} value={u.userId}>
                {u.userName ?? u.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {events.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loadingEvents")}</p>
      ) : events.error ? (
        <p className="text-sm text-cat-blocked">{events.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title={t("noEvents")} description={t("noEventsHint")} />
      ) : (
        <Panel title={t("eventsTitle")}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={`pl-4 sm:pl-5 ${head}`}>{t("time")}</TableHead>
                <TableHead className={head}>{t("event")}</TableHead>
                <TableHead className={head}>{t("user")}</TableHead>
                <TableHead className={head}>{t("ip")}</TableHead>
                <TableHead className={`pr-4 sm:pr-5 ${head}`}>{t("detail")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="py-2.5 pl-4 whitespace-nowrap text-fg-2 sm:pl-5">{stamp(e.at)}</TableCell>
                  <TableCell className={WARNING_KINDS.has(e.kind) ? "font-semibold text-cat-blocked" : "font-semibold"}>{t(`kinds.${e.kind}`)}</TableCell>
                  <TableCell>{e.userName ?? (e.discordId ? t("discordAccount", { id: e.discordId }) : "")}</TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-2">{e.ip ?? ""}</TableCell>
                  <TableCell className="max-w-[320px] truncate pr-4 text-fg-2 sm:pr-5" title={e.detail ?? undefined}>
                    {[e.apiKeyId && t("keyId", { id: e.apiKeyId }), e.detail].filter(Boolean).join(" · ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
      {events.hasNextPage && (
        <Button variant="outline" size="sm" className="w-fit" disabled={events.isFetchingNextPage} onClick={() => events.fetchNextPage()}>
          {events.isFetchingNextPage ? tc("loading") : t("loadMore")}
        </Button>
      )}
    </div>
  );
}

/** The Failed calls tab: agent tool calls that failed in the last 7 days. */
function FailedCallsTab() {
  const t = useTranslations("admin.audit");
  const trpc = useTRPC();
  const stamp = useStamp(useNow());
  const { data, isPending, error } = useQuery(trpc.admin.failedCalls.queryOptions({}));
  if (isPending) return <p className="text-sm text-muted-foreground">{t("loadingFailed")}</p>;
  if (error) return <p className="text-sm text-cat-blocked">{error.message}</p>;
  if (data.length === 0) return <EmptyState icon={<ShieldCheck />} title={t("noFailed")} description={t("noFailedHint")} />;
  return (
    <Panel title={t("failedTitle")} meta={t("last7Days")}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`pl-4 sm:pl-5 ${head}`}>{t("time")}</TableHead>
            <TableHead className={head}>{t("tool")}</TableHead>
            <TableHead className={head}>{t("user")}</TableHead>
            <TableHead className={head}>{t("where")}</TableHead>
            <TableHead className={`pr-4 sm:pr-5 ${head}`}>{t("error")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="py-2.5 pl-4 whitespace-nowrap text-fg-2 sm:pl-5">{stamp(c.at)}</TableCell>
              <TableCell className="font-mono text-[12.5px]">{c.tool}</TableCell>
              <TableCell>
                {c.userName}
                {c.runTitle && <span className="block text-xs text-muted-foreground">{c.runTitle}</span>}
              </TableCell>
              <TableCell className="text-fg-2">{[c.project, c.systemSlug, c.target].filter(Boolean).join(" / ")}</TableCell>
              <TableCell className="max-w-[360px] truncate pr-4 text-cat-blocked sm:pr-5" title={c.error ?? undefined}>
                {c.status} {c.error ?? ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/** The Keys tab: every API key with its owner and use over the last 30 days. */
function KeysTab() {
  const t = useTranslations("admin.audit");
  const format = useFormatter();
  const trpc = useTRPC();
  const now = useNow();
  const { data, isPending, error } = useQuery(trpc.admin.keyUsage.queryOptions());
  if (isPending) return <p className="text-sm text-muted-foreground">{t("loadingKeys")}</p>;
  if (error) return <p className="text-sm text-cat-blocked">{error.message}</p>;
  if (data.length === 0) return <EmptyState icon={<ShieldCheck />} title={t("noKeys")} description={t("noKeysHint")} />;
  return (
    <Panel title={t("keysTitle")} meta={t("counts30Days")}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`pl-4 sm:pl-5 ${head}`}>{t("key")}</TableHead>
            <TableHead className={head}>{t("owner")}</TableHead>
            <TableHead className={head}>{t("lastUsed")}</TableHead>
            <TableHead className={`text-right ${head}`}>{t("calls")}</TableHead>
            <TableHead className={`text-right ${head}`}>{t("errors")}</TableHead>
            <TableHead className={`pr-4 text-right sm:pr-5 ${head}`}>{t("rateLimited")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="py-2.5 pl-4 sm:pl-5">
                <span className="font-semibold">{k.name ?? t("unnamedKey")}</span>
                {k.start && <span className="ml-2 font-mono text-[12.5px] text-fg-2">{k.start}…</span>}
              </TableCell>
              <TableCell>{k.ownerName}</TableCell>
              <TableCell className="text-fg-2">{k.lastUsedAt ? format.relativeTime(k.lastUsedAt, now) : t("never")}</TableCell>
              <TableCell className="text-right tabular-nums">{format.number(k.calls30Days)}</TableCell>
              <TableCell className={k.errors30Days > 0 ? "text-right text-cat-blocked tabular-nums" : "text-right tabular-nums"}>{format.number(k.errors30Days)}</TableCell>
              <TableCell className={k.rateLimited30Days > 0 ? "pr-4 text-right text-cat-blocked tabular-nums sm:pr-5" : "pr-4 text-right tabular-nums sm:pr-5"}>
                {format.number(k.rateLimited30Days)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * The audit page body: Events, Failed calls and Keys tabs switched by `?tab=`.
 *
 * @param props.tab the tab bound to the `tab` search param
 * @param props.kind the event kind filter, from `?kind=`
 * @param props.userId the user filter, from `?user=`
 */
export function AuditView({ tab, kind, userId }: { tab: AuditTab; kind: AuthEventKind | undefined; userId: string | undefined }) {
  const t = useTranslations("admin.audit");
  const tabs = [
    { label: t("tabEvents"), href: withQuery(PATH, { kind, user: userId }, {}), active: tab === "events" },
    { label: t("tabFailed"), href: withQuery(PATH, {}, { tab: "failed" }), active: tab === "failed" },
    { label: t("tabKeys"), href: withQuery(PATH, {}, { tab: "keys" }), active: tab === "keys" },
  ];
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb") }]}
        title={t("title")}
        description={t("description")}
      />
      <UnderlineTabs label={t("title")} tabs={tabs} />
      {tab === "events" && <EventsTab kind={kind} userId={userId} />}
      {tab === "failed" && <FailedCallsTab />}
      {tab === "keys" && <KeysTab />}
    </Page>
  );
}
