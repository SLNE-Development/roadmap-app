"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import Link from "next/link";
import { AcceptAdrButton } from "@/components/accept-adr-button";
import { AdrStatusChip, AgentTag, CategoryDot } from "@/components/chips";
import { Markdown } from "@/components/markdown";
import { Page, PageHeader } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { formatAdrNumber } from "@/lib/adr-number";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * The ADR page body: number, title and meta, the accept banner for editors
 * while proposed, the four sections, and the systems it concerns.
 *
 * @param props.slug the project slug
 * @param props.number the ADR number, validated by the page
 */
export function AdrView({ slug, number }: { slug: string; number: number }) {
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
    { title: "Context", body: adr.context, highlight: false },
    { title: "Decision", body: adr.decision, highlight: true },
    { title: "Alternatives considered", body: adr.alternatives, highlight: false },
    { title: "Consequences", body: adr.consequences, highlight: false },
  ];

  return (
    <Page width="reading" className="gap-[22px]">
      <PageHeader
        crumbs={[{ label: "Decisions", href: `/p/${slug}/adrs` }, { label }]}
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
                  <span className="text-muted-foreground">via</span>
                  <AgentTag agent={adr.agent} />
                </>
              )}
            </span>
            <span>{formatDate(adr.createdAt.toISOString())}</span>
            {adr.status === "accepted" && adr.acceptedAt && <span>Accepted {formatDate(adr.acceptedAt.toISOString())}</span>}
            {adr.supersedes && (
              <Link href={`/p/${slug}/adrs/${adr.supersedes}`} className="text-brand-strong hover:underline">
                Supersedes ADR-{formatAdrNumber(adr.supersedes)}
              </Link>
            )}
            {adr.supersededBy && (
              <Link href={`/p/${slug}/adrs/${adr.supersededBy}`} className="text-brand-strong hover:underline">
                Superseded by ADR-{formatAdrNumber(adr.supersededBy)}
              </Link>
            )}
          </span>
        }
      />

      {adr.status === "proposed" && role !== "viewer" && (
        <div className="flex flex-wrap items-center gap-3 border bg-card px-4 py-3.5">
          <Clock aria-hidden className="size-4 shrink-0 text-cat-review" />
          <p className="min-w-48 flex-1 text-[13.5px] text-fg-2">Proposed decisions can still be edited. Accepting one freezes it.</p>
          <AcceptAdrButton projectSlug={slug} number={adr.number} label={label} />
        </div>
      )}

      {sections.map((s) => (
        <section key={s.title} className={cn("flex flex-col gap-2.5", s.highlight && "bg-brand-soft px-5 py-[18px]")}>
          <h2 className="font-display text-xl font-semibold">{s.title}</h2>
          <Markdown className={cn("max-w-none!", s.highlight ? "text-foreground" : "text-fg-2")}>{s.body}</Markdown>
        </section>
      ))}

      {concerns.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2.5 border-t pt-3.5 text-[13px] text-muted-foreground">
          <span>Concerns</span>
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
