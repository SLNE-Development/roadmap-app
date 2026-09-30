import { notFound } from "next/navigation";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { AdrView } from "./adr-view";

/** One ADR: its number, title and meta, the four sections, and the systems it concerns. */
export default async function AdrPage({ params }: { params: Promise<{ project: string; number: string }> }) {
  const { project: slug, number: raw } = await params;
  const number = Number(raw);
  if (!/^[0-9]{1,9}$/.test(raw) || number < 1) notFound();
  await prefetch(
    trpc.adrs.get.queryOptions({ project: slug, number }),
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <AdrView slug={slug} number={number} />
    </HydrateClient>
  );
}
