"use client";

import { useInfiniteQuery, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { UnderlineTabs, withQuery } from "@/components/activity/url-tabs";
import { useNow } from "@/components/clock";
import { EmptyState, Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AUTH_EVENT_KINDS, type AuthEventKind } from "@/db/schema";
import { formatDate, formatTime, relativeAge } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** The tab of the audit page. */
export type AuditTab = "events" | "failed" | "keys";

const PATH = "/admin/audit";

/** How each event kind reads in the list and the filter. */
const KIND_LABELS: Record<AuthEventKind, string> = {
  "sign-in": "Signed in",
  "sign-in-refused": "Sign-in refused",
  "session-ended": "Session ended",
  "key-created": "Key created",
  "key-revoked": "Key revoked",
  "key-rotated": "Key rotated",
  "key-rejected": "Key rejected",
  "key-rate-limited": "Key rate-limited",
};

/** Kinds shown in red: refusals and key failures. */
const WARNING_KINDS: ReadonlySet<AuthEventKind> = new Set(["sign-in-refused", "key-rejected", "key-rate-limited"]);

const head = "text-xs font-semibold text-muted-foreground";

/** Formats a timestamp as "12 Sep 09:05" (UTC). */
function stamp(at: Date, now: Date): string {
  return `${formatDate(at.toISOString(), now)} ${formatTime(at.toISOString())}`;
}

/** The Events tab: kind and user filters, the newest events and "Load more". */
function EventsTab({ kind, userId }: { kind: AuthEventKind | undefined; userId: string | undefined }) {
  const trpc = useTRPC();
  const router = useRouter();
  const now = useNow();
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
          <Label htmlFor="audit-kind">Kind</Label>
          <NativeSelect id="audit-kind" size="sm" value={kind ?? ""} onChange={(e) => filter({ kind: e.target.value || null })}>
            <NativeSelectOption value="">All kinds</NativeSelectOption>
            {AUTH_EVENT_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {KIND_LABELS[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-user">User</Label>
          <NativeSelect id="audit-user" size="sm" value={userId ?? ""} onChange={(e) => filter({ user: e.target.value || null })}>
            <NativeSelectOption value="">Everyone</NativeSelectOption>
            {users.map((u) => (
              <NativeSelectOption key={u.userId} value={u.userId}>
                {u.userName ?? u.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {events.isPending ? (
        <p className="text-sm text-muted-foreground">Loading events…</p>
      ) : events.error ? (
        <p className="text-sm text-cat-blocked">{events.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title="No events" description="Sign-ins, sessions and API key events appear here. They are kept for 90 days." />
      ) : (
        <Panel title="Events">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={`pl-4 sm:pl-5 ${head}`}>Time</TableHead>
                <TableHead className={head}>Event</TableHead>
                <TableHead className={head}>User</TableHead>
                <TableHead className={head}>IP</TableHead>
                <TableHead className={`pr-4 sm:pr-5 ${head}`}>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="py-2.5 pl-4 whitespace-nowrap text-fg-2 sm:pl-5">{stamp(e.at, now)}</TableCell>
                  <TableCell className={WARNING_KINDS.has(e.kind) ? "font-semibold text-cat-blocked" : "font-semibold"}>{KIND_LABELS[e.kind]}</TableCell>
                  <TableCell>{e.userName ?? (e.discordId ? `Discord ${e.discordId}` : "")}</TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-2">{e.ip ?? ""}</TableCell>
                  <TableCell className="max-w-[320px] truncate pr-4 text-fg-2 sm:pr-5" title={e.detail ?? undefined}>
                    {[e.apiKeyId && `Key ${e.apiKeyId}`, e.detail].filter(Boolean).join(" · ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
      {events.hasNextPage && (
        <Button variant="outline" size="sm" className="w-fit" disabled={events.isFetchingNextPage} onClick={() => events.fetchNextPage()}>
          {events.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

/** The Failed calls tab: agent tool calls that failed in the last 7 days. */
function FailedCallsTab() {
  const trpc = useTRPC();
  const now = useNow();
  const { data, isPending, error } = useQuery(trpc.admin.failedCalls.queryOptions({}));
  if (isPending) return <p className="text-sm text-muted-foreground">Loading failed calls…</p>;
  if (error) return <p className="text-sm text-cat-blocked">{error.message}</p>;
  if (data.length === 0) return <EmptyState icon={<ShieldCheck />} title="No failed calls" description="Agent tool calls that failed in the last 7 days appear here." />;
  return (
    <Panel title="Failed calls" meta="Last 7 days">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`pl-4 sm:pl-5 ${head}`}>Time</TableHead>
            <TableHead className={head}>Tool</TableHead>
            <TableHead className={head}>User</TableHead>
            <TableHead className={head}>Where</TableHead>
            <TableHead className={`pr-4 sm:pr-5 ${head}`}>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="py-2.5 pl-4 whitespace-nowrap text-fg-2 sm:pl-5">{stamp(c.at, now)}</TableCell>
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
  const trpc = useTRPC();
  const now = useNow();
  const { data, isPending, error } = useQuery(trpc.admin.keyUsage.queryOptions());
  if (isPending) return <p className="text-sm text-muted-foreground">Loading keys…</p>;
  if (error) return <p className="text-sm text-cat-blocked">{error.message}</p>;
  if (data.length === 0) return <EmptyState icon={<ShieldCheck />} title="No API keys" description="Keys that users create on their API keys page appear here." />;
  return (
    <Panel title="API keys" meta="Counts over 30 days">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`pl-4 sm:pl-5 ${head}`}>Key</TableHead>
            <TableHead className={head}>Owner</TableHead>
            <TableHead className={head}>Last used</TableHead>
            <TableHead className={`text-right ${head}`}>Calls</TableHead>
            <TableHead className={`text-right ${head}`}>Errors</TableHead>
            <TableHead className={`pr-4 text-right sm:pr-5 ${head}`}>Rate-limited</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="py-2.5 pl-4 sm:pl-5">
                <span className="font-semibold">{k.name ?? "Unnamed key"}</span>
                {k.start && <span className="ml-2 font-mono text-[12.5px] text-fg-2">{k.start}…</span>}
              </TableCell>
              <TableCell>{k.ownerName}</TableCell>
              <TableCell className="text-fg-2">{k.lastUsedAt ? relativeAge(k.lastUsedAt.toISOString(), now) : "Never"}</TableCell>
              <TableCell className="text-right tabular-nums">{k.calls30Days}</TableCell>
              <TableCell className={k.errors30Days > 0 ? "text-right text-cat-blocked tabular-nums" : "text-right tabular-nums"}>{k.errors30Days}</TableCell>
              <TableCell className={k.rateLimited30Days > 0 ? "pr-4 text-right text-cat-blocked tabular-nums sm:pr-5" : "pr-4 text-right tabular-nums sm:pr-5"}>
                {k.rateLimited30Days}
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
  const tabs = [
    { label: "Events", href: withQuery(PATH, { kind, user: userId }, {}), active: tab === "events" },
    { label: "Failed calls", href: withQuery(PATH, {}, { tab: "failed" }), active: tab === "failed" },
    { label: "Keys", href: withQuery(PATH, {}, { tab: "keys" }), active: tab === "keys" },
  ];
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Admin" }]}
        title="Audit"
        description="Sign-ins, sessions and API key events, failed agent tool calls, and how each key is used."
      />
      <UnderlineTabs label="Audit" tabs={tabs} />
      {tab === "events" && <EventsTab kind={kind} userId={userId} />}
      {tab === "failed" && <FailedCallsTab />}
      {tab === "keys" && <KeysTab />}
    </Page>
  );
}
