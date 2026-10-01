"use client";

import { useMutation, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { Check, Clock, Link2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AcceptAdrButton } from "@/components/accept-adr-button";
import { AdrStatusChip, AgentTag, CategoryDot } from "@/components/chips";
import { Markdown } from "@/components/markdown";
import { Page, PageHeader } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { TaskStateBox } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AdrDetail } from "@/lib/ops/adrs";
import { formatAdrNumber } from "@/lib/adr-number";
import { useShortDate } from "@/lib/use-short-date";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The message of each field an ADR edit can name. */
const EDITED_FIELDS = {
  title: "detail.fieldTitle",
  context: "detail.sections.context",
  decision: "detail.sections.decision",
  alternatives: "detail.sections.alternatives",
  consequences: "detail.sections.consequences",
  systems: "detail.fieldSystems",
} as const;

/** Describes one history entry as a sentence, without its date and author. */
function historyLabel(t: ReturnType<typeof useTranslations<"adrs">>, format: ReturnType<typeof useFormatter>, h: AdrDetail["history"][number]): string {
  if (h.field === "created") return t("detail.historyProposed");
  if (h.field === "status" && h.newValue === "accepted") return t("detail.historyAccepted");
  if (h.field === "status" && h.newValue?.startsWith("superseded by ")) return t("supersededBy", { number: h.newValue.slice("superseded by ".length) });
  if (h.field === "task") return h.newValue ? t("detail.historyLinkedTask", { task: h.newValue }) : t("detail.historyUnlinkedTask", { task: h.oldValue ?? "" });
  if (h.field === "edited") {
    // The logged value lists the edited fields, comma separated.
    const names = (h.newValue ?? "").split(",").map((f) => f.trim()).filter(Boolean).map((f) => (f in EDITED_FIELDS ? t(EDITED_FIELDS[f as keyof typeof EDITED_FIELDS]) : f));
    return t("detail.historyEdited", { what: format.list(names, { type: "conjunction" }) });
  }
  return t("detail.historyChanged", { field: h.field });
}

/**
 * A button opening a searchable list of the project's tasks; choosing one links
 * or unlinks it. Links may change at any ADR status.
 *
 * @param props.linked the ids of the tasks the ADR links to now
 */
function LinkTasks({ slug, number, linked }: { slug: string; number: number; linked: number[] }) {
  const t = useTranslations("adrs.linkTasks");
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const tasks = useQuery({ ...trpc.adrs.linkableTasks.queryOptions({ project: slug }), enabled: open });
  const setTasks = useMutation(trpc.adrs.setTasks.mutationOptions({ onError: (e) => toast.error(e.message) }));
  const toggle = (id: number) =>
    setTasks.mutate({ project: slug, number, tasks: linked.includes(id) ? linked.filter((l) => l !== id) : [...linked, id] });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 aria-hidden />
          {t("button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>{tasks.isPending ? t("loading") : t("none")}</CommandEmpty>
            {(tasks.data ?? []).map((task) => (
              <CommandItem key={task.id} value={`${task.title} ${task.systemSlug} ${task.id}`} disabled={setTasks.isPending} onSelect={() => toggle(task.id)}>
                <Check aria-hidden className={cn("size-4", !linked.includes(task.id) && "invisible")} />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <span className="text-xs text-muted-foreground">{task.systemSlug}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The ADR page body: number, title and meta, the accept banner for editors
 * while proposed, the four sections, and the systems it concerns.
 *
 * @param props.slug the project slug
 * @param props.number the ADR number, validated by the page
 */
export function AdrView({ slug, number }: { slug: string; number: number }) {
  const t = useTranslations("adrs");
  const shortDate = useShortDate();
  const format = useFormatter();
  const trpc = useTRPC();
  const [{ data: adr }, { data: detail }, { data: systems }] = useSuspenseQueries({
    queries: [
      trpc.adrs.get.queryOptions({ project: slug, number }),
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
    ],
  });
  const role = detail.role;
  const label = `ADR-${formatAdrNumber(adr.number)}`;
  const concerns = adr.systems.map((s) => systems.find((x) => x.slug === s) ?? { slug: s, title: s, columnCategory: null });
  const sections = [
    { key: "context", title: t("detail.sections.context"), body: adr.context, highlight: false },
    { key: "decision", title: t("detail.sections.decision"), body: adr.decision, highlight: true },
    { key: "alternatives", title: t("detail.sections.alternatives"), body: adr.alternatives, highlight: false },
    { key: "consequences", title: t("detail.sections.consequences"), body: adr.consequences, highlight: false },
  ];

  return (
    <Page width="reading" className="gap-[22px]">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }, { label: t("title"), href: `/p/${slug}/adrs` }, { label }]}
        title={
          <>
            <span className="mb-2.5 block font-mono text-[13px] font-normal tracking-normal text-muted-foreground">{label}</span>
            {adr.title}
          </>
        }
        description={
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <AdrStatusChip status={adr.status} />
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <PersonName name={adr.authorName} />
              {adr.agent && (
                <>
                  <span className="text-muted-foreground">{t("detail.via")}</span>
                  <AgentTag agent={adr.agent} />
                </>
              )}
            </span>
            <span>{shortDate(adr.createdAt)}</span>
            {adr.status === "accepted" && adr.acceptedAt && <span>{t("detail.acceptedOn", { date: shortDate(adr.acceptedAt) })}</span>}
            {adr.supersedes && (
              <Link href={`/p/${slug}/adrs/${adr.supersedes}`} className="text-brand-strong hover:underline">
                {t("supersedes", { number: formatAdrNumber(adr.supersedes) })}
              </Link>
            )}
            {adr.supersededBy && (
              <Link href={`/p/${slug}/adrs/${adr.supersededBy}`} className="text-brand-strong hover:underline">
                {t("supersededBy", { number: formatAdrNumber(adr.supersededBy) })}
              </Link>
            )}
          </span>
        }
      />

      {adr.status === "proposed" && role !== "viewer" && !detail.project.archivedAt && (
        <div className="flex flex-wrap items-center gap-3 border bg-card px-4 py-3.5">
          <Clock aria-hidden className="size-4 shrink-0 text-cat-review" />
          <p className="min-w-48 flex-1 text-[13.5px] text-fg-2">{t("detail.proposedBanner")}</p>
          <AcceptAdrButton projectSlug={slug} number={adr.number} label={label} />
        </div>
      )}

      {sections.map((s) => (
        <section key={s.key} className={cn("flex flex-col gap-2.5", s.highlight && "bg-brand-soft px-5 py-[18px]")}>
          <h2 className="font-display text-xl font-semibold">{s.title}</h2>
          <Markdown className={cn("max-w-none!", s.highlight ? "text-foreground" : "text-fg-2")}>{s.body}</Markdown>
        </section>
      ))}

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{t("detail.tasks")}</h2>
          {role !== "viewer" && !detail.project.archivedAt && (
            <LinkTasks slug={slug} number={adr.number} linked={adr.tasks.map((task) => task.id)} />
          )}
        </div>
        {adr.tasks.length === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">{t("detail.noTasks")}</p>
        ) : (
          <ul className="flex flex-col border">
            {adr.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0">
                <TaskStateBox state={task.state} />
                <span className="min-w-0 flex-1 text-[13.5px]">{task.title}</span>
                <Link href={`/p/${slug}/systems/${task.systemSlug}`} className="text-[13px] text-brand-strong hover:underline">
                  {task.systemSlug}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="font-display text-xl font-semibold">{t("detail.history")}</h2>
        <ol className="flex flex-col gap-3 border-l pl-4">
          {adr.history.map((h, i) => (
            <li key={i} className="text-[13.5px] text-fg-2">
              {h.field === "created" || h.field === "edited" || h.newValue === "accepted"
                ? t("detail.historyWithAuthor", { label: historyLabel(t, format, h), name: h.authorName ?? h.agent ?? t("detail.someone") })
                : historyLabel(t, format, h)}
              <span className="text-muted-foreground"> · {shortDate(h.at)}</span>
            </li>
          ))}
        </ol>
      </section>

      {concerns.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2.5 border-t pt-3.5 text-[13px] text-muted-foreground">
          <span>{t("detail.concerns")}</span>
          {concerns.map((s) => (
            <Link
              key={s.slug}
              href={`/p/${slug}/systems/${s.slug}`}
              className="inline-flex items-center gap-1.5 border px-2 py-[3px] text-foreground hover:bg-muted"
            >
              {s.columnCategory && <CategoryDot category={s.columnCategory} className="size-[7px]" />}
              {s.title}
            </Link>
          ))}
        </footer>
      )}
    </Page>
  );
}
