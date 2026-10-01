"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { CircleAlert, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { EventProgressBar } from "@/components/events/progress-bar";
import { openCount } from "@/components/events/question-form";
import { PersonName } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/event-status";
import type { RequestDetail, RequestHistoryItem } from "@/lib/ops/requests";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** Returns whether `value` is a request status. */
const isStatus = (value: string | null): value is RequestStatus => REQUEST_STATUSES.includes(value as RequestStatus);

/** The kinds of post the rail shows the state of, in due order. */
const POST_KINDS = ["team", "announcement", "reminder"] as const;

/** Colours of a post's state badge. */
const STATE_CLASS: Record<string, string> = {
  posted: "bg-cat-done-soft text-cat-done",
  sending: "bg-cat-active-soft text-cat-active",
  partial: "bg-cat-active-soft text-cat-active",
  failed: "bg-danger-soft text-destructive",
};

/** A panel of the right rail: the heading, an optional link on the right and the body. */
function RailPanel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The small link on the right of a panel heading. */
const PANEL_LINK = "text-[12.5px] font-medium text-brand-strong hover:underline";

/** Turns a history row into a sentence, in the request's words. */
export function useHistorySentence(): (row: RequestHistoryItem) => string {
  const t = useTranslations("events");
  return (r) => {
    const name = r.author;
    const status = (value: string | null) => (isStatus(value) ? t(`status.${value}`) : (value ?? ""));
    if (r.field === "created") return t("history.created", { name });
    if (r.field === "brief") return t("history.brief", { name, from: r.oldValue ?? "", to: r.newValue ?? "" });
    if (r.field === "status") {
      if (isStatus(r.oldValue) && !isStatus(r.newValue)) return t("history.cancelled", { name, reason: r.newValue ?? "" });
      return t("history.status", { name, from: status(r.oldValue), to: status(r.newValue) });
    }
    const known = ["title", "startsAt", "durationMinutes", "where", "summary", "banner", "eventDocsUrl", "requesterId"] as const;
    const field = known.find((k) => k === r.field);
    return t("history.entry", { name, field: field ? t(`history.field.${field}`) : r.field });
  };
}

/** The history rows as sentences with their time. */
function HistoryRows({ rows }: { rows: RequestHistoryItem[] }) {
  const t = useTranslations("events.history");
  const format = useFormatter();
  const sentence = useHistorySentence();
  if (rows.length === 0) return <p className="text-[12.5px] text-fg-2">{t("empty")}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5 text-[13px] leading-[1.4]">
          <span>{sentence(r)}</span>
          <time dateTime={r.createdAt.toISOString()} className="text-xs text-muted-foreground">
            {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
          </time>
        </li>
      ))}
    </ul>
  );
}

/**
 * The right rail of the Overview: what needs attention, the Discord event and message states, build progress, the next
 * three to-dos and the last five history sentences (the sheet has all of them).
 *
 * @param props.detail the request with the actor's rights
 */
export function RequestRail({ detail }: { detail: RequestDetail }) {
  const t = useTranslations("events");
  const tr = useTranslations("events.rail");
  const format = useFormatter();
  const trpc = useTRPC();
  const { request, canEdit, canDevelop, canManage, discordEvent } = detail;
  const id = request.id;
  const [{ data: rounds }, { data: fallbacks }, { data: todos }, { data: posts }, { data: progress }, { data: history }] = useSuspenseQueries({
    queries: [
      trpc.requests.rounds.queryOptions({ id }),
      trpc.requests.fallbacks.queryOptions({ id }),
      trpc.requests.todos.queryOptions({ id }),
      trpc.requests.posts.list.queryOptions({ id }),
      trpc.requests.progress.queryOptions({ id }),
      trpc.requests.history.queryOptions({ id }),
    ],
  });
  const { status } = request;
  const base = `/requests/${id}`;
  const open = status === "draft" || status === "submitted" || status === "accepted" || status === "event_week";
  const live = status === "accepted" || status === "event_week";
  const showEvent = live || status === "done";

  const questions = canEdit ? openCount(rounds) : 0;
  const incomplete = fallbacks.filter((f) => f.required && (!f.whatWeDo.trim() || !f.whoDecides.trim()));
  const lateTodos = todos.filter((todo) => todo.late && !todo.doneAt).length;
  const lateMessages = posts.posts.filter((p) => p.late).length;
  const staff = canManage || canDevelop;
  const attention: { key: string; text: string; href?: string; late?: boolean }[] = [];
  if (open && questions > 0) attention.push({ key: "questions", text: tr("attention.questions", { count: questions }), href: `${base}?tab=questions` });
  if (status === "accepted" && (canEdit || canDevelop) && incomplete.length > 0) {
    attention.push({ key: "fallback", text: tr("attention.fallback", { scenarios: incomplete.map((f) => f.title).join(", ") }), href: `${base}?tab=fallback` });
  }
  if (open && lateTodos > 0) attention.push({ key: "todos", text: tr("attention.lateTodos", { count: lateTodos }), href: `${base}?tab=prep`, late: true });
  if (live && lateMessages > 0) attention.push({ key: "messages", text: tr("attention.lateMessages", { count: lateMessages }), href: `${base}?tab=messages`, late: true });
  if (live) {
    if (discordEvent.reason === "no-token" || discordEvent.reason === "no-guild") {
      if (staff) attention.push({ key: "bot", text: t(discordEvent.reason === "no-token" ? "discordEvent.noToken" : "discordEvent.noGuild"), href: "/requests/settings" });
    } else if (!request.eventDocsUrl) {
      attention.push({ key: "docs", text: t("discordEvent.noDocs"), href: `${base}?tab=overview#request-details` });
    }
  }

  const nextTodos = todos
    .filter((todo) => !todo.doneAt)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 3);
  const noEventReason = discordEvent.reason === "no-token" ? "noToken" : discordEvent.reason === "no-guild" ? "noGuild" : "notYet";

  return (
    <aside aria-label={t("page.rail")} className="flex min-w-0 flex-col gap-4">
      {open && (
        <RailPanel title={tr("attention.title")}>
          {attention.length === 0 ? (
            <p className="text-[12.5px] text-fg-2">{tr("attention.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {attention.map((a) => {
                const body = (
                  <>
                    <CircleAlert aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", a.late ? "text-destructive" : "text-cat-planning")} />
                    <span>{a.text}</span>
                  </>
                );
                return (
                  <li key={a.key}>
                    {a.href ? (
                      <Link href={a.href} className="flex items-start gap-2 text-[13px] leading-[1.4] hover:text-brand-strong hover:underline">
                        {body}
                      </Link>
                    ) : (
                      <span className="flex items-start gap-2 text-[13px] leading-[1.4]">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </RailPanel>
      )}
      {showEvent && (
        <RailPanel title={tr("discord.title")} action={<Link href={`${base}?tab=messages`} className={PANEL_LINK}>{tr("discord.messages")}</Link>}>
          {discordEvent.url ? (
            <a href={discordEvent.url} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-brand-strong hover:underline">
              {tr("discord.open")}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : (
            <p className="text-[12.5px] text-fg-2">{t(`discordEvent.${noEventReason}`)}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {POST_KINDS.map((kind) => {
              const post = posts.posts.find((p) => p.kind === kind);
              const state = post?.status ?? "none";
              return (
                <li key={kind} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-fg-2">{tr(`discord.post.${kind}`)}</span>
                  {post?.late && <span className="text-xs font-medium text-destructive">{t("messages.late")}</span>}
                  <Link href={`${base}?tab=messages`} aria-label={`${tr(`discord.post.${kind}`)}: ${tr(`discord.state.${state}`)}`}>
                    <Badge variant="outline" className={cn("border-transparent", STATE_CLASS[state] ?? "bg-secondary text-muted-foreground")}>
                      {tr(`discord.state.${state}`)}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </RailPanel>
      )}
      {progress && <EventProgressBar progress={progress} />}
      {showEvent && (
        <RailPanel title={tr("todos.title")} action={<Link href={`${base}?tab=prep`} className={PANEL_LINK}>{tr("todos.all")}</Link>}>
          {nextTodos.length === 0 ? (
            <p className="text-[12.5px] text-fg-2">{tr("todos.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {nextTodos.map((todo) => (
                <li key={todo.id} className="flex flex-col gap-0.5 text-[13px] leading-[1.4]">
                  <span>{todo.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                    <span className={cn(todo.late && "font-medium text-destructive")}>{todo.late ? tr("todos.late") : tr("todos.due", { date: format.dateTime(todo.dueAt, { day: "numeric", month: "short" }) })}</span>
                    {todo.ownerName && <PersonName name={todo.ownerName} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RailPanel>
      )}
      <RailPanel
        title={t("history.title")}
        action={
          history.length > 5 && (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="link" size="sm" className="h-auto p-0 text-[12.5px]">
                  {t("history.showAll")}
                </Button>
              </SheetTrigger>
              <SheetContent className="sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>{t("history.title")}</SheetTitle>
                  <SheetDescription>{t("history.sheetDescription")}</SheetDescription>
                </SheetHeader>
                <div className="overflow-y-auto px-4 pb-6">
                  <HistoryRows rows={history} />
                </div>
              </SheetContent>
            </Sheet>
          )
        }
      >
        <HistoryRows rows={history.slice(0, 5)} />
      </RailPanel>
    </aside>
  );
}
