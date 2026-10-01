import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { PageView } from "./page-view";

/** Parses a version search parameter, returning undefined unless it is a listed version. */
function version(value: string | string[] | undefined, known: number[]): number | undefined {
  const n = typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : NaN;
  return known.includes(n) ? n : undefined;
}

/**
 * Parses the `compare` search parameter (`from..to`) against the listed versions.
 * Any present but invalid value falls back to the last two versions; undefined without
 * the parameter or with fewer than two versions.
 */
function compare(value: string | string[] | undefined, known: number[]): { from: number; to: number } | undefined {
  if (value === undefined || known.length < 2) return undefined;
  const m = typeof value === "string" ? /^([1-9]\d{0,8})\.\.([1-9]\d{0,8})$/.exec(value) : null;
  const from = m ? Number(m[1]) : NaN;
  const to = m ? Number(m[2]) : NaN;
  if (known.includes(from) && known.includes(to) && from < to) return { from, to };
  return { from: known[1], to: known[0] };
}

/**
 * One project page rendered as markdown with its outline and glossary terms, a version picker
 * (`?v=`) and a compare view (`?compare=from..to`); editors can edit it.
 */
export default async function ProjectPagePage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; page: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug, page } = await params;
  const sp = await searchParams;
  const ref = { project: slug, page };
  const [latest] = await prefetch(trpc.pages.get.queryOptions(ref));
  const shown = version(sp.v, latest.versions);
  const comparing = compare(sp.compare, latest.versions);
  await Promise.all([
    prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.glossary.list.queryOptions({ project: slug })),
    shown && prefetch(trpc.pages.get.queryOptions({ ...ref, version: shown })),
    comparing && prefetch(trpc.pages.compare.queryOptions({ ...ref, ...comparing })),
  ]);
  return (
    <HydrateClient>
      <PageView projectSlug={slug} pageSlug={page} version={shown} compare={comparing} />
    </HydrateClient>
  );
}
