"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isOpen, type RequestStatus } from "@/lib/event-status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The filter chips: the statuses of an event's life, then the two that ended without happening. */
const CHIPS = ["draft", "submitted", "accepted", "event_week", "done", "closed"] as const;
type Chip = (typeof CHIPS)[number];

/** The statuses a chip stands for. */
function statusesOf(chip: Chip): readonly RequestStatus[] {
  return chip === "closed" ? ["withdrawn", "cancelled"] : [chip];
}

const HEAD = "px-3 py-2";

/** The "New request" button and dialog: asks for a title, creates the draft and opens it. */
function NewRequestDialog() {
  const t = useTranslations("events.list");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation(
    trpc.requests.create.mutationOptions({
      onSuccess: ({ id }) => {
        setOpen(false);
        setTitle("");
        router.push(`/requests/${id}`);
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("newRequest")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ title, brief: "" });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-request-title">{t("titleLabel")}</FieldLabel>
              <Input id="new-request-title" value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !title.trim()}>
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The requests list: status chips with counts (none chosen shows every open request), then a table
 * with title, status, date, requester and linked project. Managers and admins can start a new request.
 */
export function RequestsView() {
  const t = useTranslations("events");
  const format = useFormatter();
  const trpc = useTRPC();
  const [chosen, setChosen] = useState<ReadonlySet<Chip>>(new Set());
  const [{ data: rows }, { data: me }] = useSuspenseQueries({ queries: [trpc.requests.list.queryOptions({}), trpc.account.me.queryOptions()] });
  const count = (chip: Chip) => rows.filter((r) => statusesOf(chip).includes(r.status)).length;
  const shown = rows.filter((r) => (chosen.size === 0 ? isOpen(r.status) : [...chosen].some((c) => statusesOf(c).includes(r.status))));
  const toggle = (chip: Chip) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(chip)) next.add(chip);
      return next;
    });

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb") }]}
        title={t("list.title")}
        description={t("list.description")}
        actions={
          me.isAdmin || me.isEventManager || me.isEventDeveloper ? (
            <>
              <Button asChild variant="outline">
                <Link href="/requests/settings">{t("list.settings")}</Link>
              </Button>
              {me.isAdmin || me.isEventManager ? <NewRequestDialog /> : null}
            </>
          ) : undefined
        }
      />
      <div role="group" aria-label={t("list.filterLabel")} className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => {
          const on = chosen.has(chip);
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(chip)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-[13px] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                on ? "border border-primary bg-brand-soft font-medium text-brand-strong" : "border border-dashed text-fg-2 hover:text-foreground",
              )}
            >
              {chip === "closed" ? t("list.closed") : t(`status.${chip}`)}
              <span className="text-xs text-muted-foreground">{count(chip)}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={t("list.emptyTitle")} description={rows.length === 0 ? t("list.emptyNone") : t("list.emptyText")} />
      ) : (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b bg-secondary text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <th scope="col" className={HEAD}>
                  {t("list.colTitle")}
                </th>
                <th scope="col" className={HEAD}>
                  {t("list.colStatus")}
                </th>
                <th scope="col" className={HEAD}>
                  {t("list.colDate")}
                </th>
                <th scope="col" className={HEAD}>
                  {t("list.colRequester")}
                </th>
                <th scope="col" className={HEAD}>
                  {t("list.colProject")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <Link href={`/requests/${r.id}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {t(`status.${r.status}`)}
                      {r.waitingOnRequester && <Badge variant="outline">{t("list.waitingOnRequester")}</Badge>}
                      {r.lateTodos > 0 && <Badge variant="destructive">{t("list.lateTodos", { count: r.lateTodos })}</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.startsAt ? format.dateTime(r.startsAt, { dateStyle: "medium", timeStyle: "short" }) : <span className="text-muted-foreground">{t("list.noDate")}</span>}
                  </td>
                  <td className="px-3 py-2">{r.requesterName}</td>
                  <td className="px-3 py-2">
                    {r.projectSlug ? (
                      <Link href={`/p/${r.projectSlug}`} className="hover:underline">
                        {r.projectSlug}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t("list.noProject")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
