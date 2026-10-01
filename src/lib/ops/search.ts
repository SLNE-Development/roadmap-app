import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { adr, pageVersion, projectPage, question, system, systemDocument } from "@/db/schema";
import type { Executor } from "@/db/types";
import { toPrefixQuery } from "@/lib/search-query";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

/** What a search can find, in the order equal ranks are listed. */
export const SEARCH_KINDS = ["system", "spec", "plan", "adr", "page", "question"] as const;

/** A kind of search hit. */
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Input of {@link searchProject}. */
export const searchProjectInput = z.object({
  q: z.string().max(200),
  kinds: z.array(z.enum(["system", "spec", "plan", "adr", "question", "page"])).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

/** A match of a search; `snippet` marks matched words with `\u0002` and `\u0003`. */
export interface SearchHit {
  kind: "system" | "spec" | "plan" | "adr" | "question" | "page";
  title: string;
  href: string;
  snippet: string;
  rank: number;
}

/** A {@link SearchHit} with the slug, number or id other tools take (`ref`). */
export type SearchHitWithRef = SearchHit & { ref: string };

/** Options of `ts_headline`: one short fragment with the matches between control characters. */
const HEADLINE = "StartSel=\u0002,StopSel=\u0003,MaxWords=18,MinWords=6,MaxFragments=1";

interface Row {
  kind: SearchKind;
  title: string;
  ref: string;
  system_slug: string | null;
  snippet: string;
  rank: number | string;
}

/**
 * Builds one branch of the union per wanted kind. Each yields kind, its order, title, ref, the
 * system slug, the text a snippet is taken from and the rank; archived systems and everything of
 * theirs are left out, and only the latest version of each document and page is searched.
 */
function branches(projectId: string, kinds: ReadonlySet<SearchKind>): SQL[] {
  const parts: SQL[] = [];
  if (kinds.has("system")) {
    parts.push(sql`
      select 'system' as kind, 0 as kind_order, s.title, s.slug as ref, s.slug as system_slug, concat_ws(' ', s.summary, s.notes) as doc, ts_rank_cd(s.search, q.q) as rank
      from ${system} s, q
      where s.project_id = ${projectId} and s.archived_at is null and s.search @@ q.q`);
  }
  const docKinds = (["spec", "plan"] as const).filter((k) => kinds.has(k));
  if (docKinds.length > 0) {
    parts.push(sql`
      select d.kind, case d.kind when 'spec' then 1 else 2 end as kind_order, s.title, s.slug as ref, s.slug as system_slug, d.body as doc, ts_rank_cd(d.search, q.q) as rank
      from (
        select distinct on (system_id, kind) system_id, kind, body, search
        from ${systemDocument}
        where kind in (${sql.join(docKinds.map((k) => sql`${k}`), sql`, `)})
          and system_id in (select id from ${system} where project_id = ${projectId} and archived_at is null)
        order by system_id, kind, version desc
      ) d
      join ${system} s on s.id = d.system_id, q
      where d.search @@ q.q`);
  }
  if (kinds.has("adr")) {
    parts.push(sql`
      select 'adr' as kind, 3 as kind_order, a.title, a.number::text as ref, null as system_slug, concat_ws(' ', a.context, a.decision, a.alternatives, a.consequences) as doc, ts_rank_cd(a.search, q.q) as rank
      from ${adr} a, q
      where a.project_id = ${projectId} and a.search @@ q.q`);
  }
  if (kinds.has("page")) {
    parts.push(sql`
      select 'page' as kind, 4 as kind_order, p.title, p.slug as ref, null as system_slug, v.body as doc, ts_rank_cd(setweight(to_tsvector('english', p.title), 'A') || v.search, q.q) as rank
      from (
        select distinct on (page_id) page_id, body, search
        from ${pageVersion}
        where page_id in (select id from ${projectPage} where project_id = ${projectId})
        order by page_id, version desc
      ) v
      join ${projectPage} p on p.id = v.page_id, q
      where v.search @@ q.q or to_tsvector('english', p.title) @@ q.q`);
  }
  if (kinds.has("question")) {
    parts.push(sql`
      select 'question' as kind, 5 as kind_order, qu.title, qu.id as ref, s.slug as system_slug, concat_ws(' ', qu.text, qu.answer) as doc, ts_rank_cd(qu.search, q.q) as rank
      from ${question} qu
      left join ${system} s on s.id = qu.system_id, q
      where qu.project_id = ${projectId} and s.archived_at is null and qu.search @@ q.q`);
  }
  return parts;
}

/** The page a hit opens in the web UI. */
function hrefOf(projectSlug: string, row: Row): string {
  const base = `/p/${projectSlug}`;
  switch (row.kind) {
    case "system":
      return `${base}/systems/${row.ref}`;
    case "spec":
    case "plan":
      return `${base}/systems/${row.ref}?tab=${row.kind}`;
    case "adr":
      return `${base}/adrs/${row.ref}`;
    case "page":
      return `${base}/pages/${row.ref}`;
    case "question":
      return row.system_slug ? `${base}/questions?system=${row.system_slug}` : `${base}/questions`;
  }
}

/**
 * Searches the project like {@link searchProject} and also returns each hit's `ref`: the system
 * slug (for systems, specs and plans), ADR number, question id or page slug. Viewer or higher.
 */
export async function searchProjectWithRefs(db: Executor, actor: Actor, projectSlug: string, raw: z.input<typeof searchProjectInput>): Promise<SearchHitWithRef[]> {
  const input = searchProjectInput.parse(raw);
  const query = toPrefixQuery(input.q);
  if (query === null) return [];
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const parts = branches(project.id, new Set(input.kinds ?? SEARCH_KINDS));
  if (parts.length === 0) return [];
  // Headlines are costly on long bodies, so they are made only for the hits within the limit.
  const result = await db.execute(sql`
    with q as (select to_tsquery('english', ${query}) as q),
    hits as (${sql.join(parts, sql` union all `)})
    select top.kind, top.title, top.ref, top.system_slug, ts_headline('english', top.doc, q.q, ${HEADLINE}) as snippet, top.rank::float8 as rank
    from (select * from hits order by rank desc, kind_order, title limit ${input.limit}) top, q
    order by top.rank desc, top.kind_order, top.title`);
  // postgres-js returns the rows themselves, PGlite wraps them.
  const rows = (Array.isArray(result) ? result : (result as unknown as { rows: unknown[] }).rows) as Row[];
  return rows.map((row) => ({ kind: row.kind, title: row.title, href: hrefOf(project.slug, row), snippet: row.snippet, rank: Number(row.rank), ref: row.ref }));
}

/**
 * Full-text search in the project's systems, latest specs and plans, ADRs, pages and questions,
 * best match first. Archived systems and their documents are left out; a query without a word of
 * two or more letters or digits returns nothing. Viewer or higher.
 */
export async function searchProject(db: Executor, actor: Actor, projectSlug: string, raw: z.input<typeof searchProjectInput>): Promise<SearchHit[]> {
  return (await searchProjectWithRefs(db, actor, projectSlug, raw)).map(({ kind, title, href, snippet, rank }) => ({ kind, title, href, snippet, rank }));
}
