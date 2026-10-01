import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import { pageVersion, projectPage, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { diffDocuments, unifiedDiff, type DiffHunk } from "@/lib/diff";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { lockProject } from "./lookup";

/** Input of {@link writePage}; `baseVersion` is the latest version the writer saw, to catch a concurrent edit. */
export const writePageInput = z.object({
  page: slugSchema,
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(200_000),
  baseVersion: z.number().int().min(1).max(2_147_483_647).optional(),
});

/** A page in {@link listPages} with its latest version. */
export interface PageListItem {
  slug: string;
  title: string;
  version: number;
  updatedAt: Date;
  authorName: string;
  agent: string | null;
}

/** A version of a project page with the list of all its versions, newest first. */
export interface PageView extends AuthorFields {
  slug: string;
  title: string;
  version: number;
  body: string;
  createdAt: Date;
  versions: number[];
}

/** The changes of a page since an older version, as a unified diff instead of the body. */
export type PageChanges = Omit<PageView, "body"> & { since: number; diff: string };

/** Two versions of a page with the differences between them. */
export interface PageComparison {
  from: PageView;
  to: PageView;
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

type PageRow = typeof projectPage.$inferSelect;

/** Lists the project's pages with their latest version, by order then title. Viewer or higher. */
export async function listPages(db: Executor, actor: Actor, projectSlug: string): Promise<PageListItem[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const rows = await db
    .select({ slug: projectPage.slug, title: projectPage.title, version: pageVersion.version, updatedAt: pageVersion.createdAt, authorName: user.name, agent: pageVersion.agent })
    .from(projectPage)
    .innerJoin(pageVersion, eq(pageVersion.pageId, projectPage.id))
    .leftJoin(user, eq(user.id, pageVersion.authorUserId))
    .where(and(eq(projectPage.projectId, project.id), eq(pageVersion.version, sql`(select max(pv.version) from page_version pv where pv.page_id = ${projectPage.id})`)))
    .orderBy(asc(projectPage.sortOrder), asc(projectPage.title));
  return rows.map(({ authorName, ...row }) => ({ ...row, authorName: authorFields(authorName, row.agent).authorName }));
}

/** Finds a page of the project, optionally locking its row until the transaction ends. */
async function findPage(db: Executor, projectId: string, slug: string, lock = false): Promise<PageRow | undefined> {
  const query = db
    .select()
    .from(projectPage)
    .where(and(eq(projectPage.projectId, projectId), eq(projectPage.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

/** Loads the given version (or the latest) of a page, or `null` when it has no such version. */
async function loadVersion(db: Executor, page: PageRow, version?: number): Promise<PageView | null> {
  const versions = (await db.select({ version: pageVersion.version }).from(pageVersion).where(eq(pageVersion.pageId, page.id)).orderBy(desc(pageVersion.version))).map((v) => v.version);
  const wanted = version ?? versions[0];
  if (wanted === undefined) return null;
  const [row] = await db
    .select({ body: pageVersion.body, createdAt: pageVersion.createdAt, agent: pageVersion.agent, authorName: user.name })
    .from(pageVersion)
    .leftJoin(user, eq(user.id, pageVersion.authorUserId))
    .where(and(eq(pageVersion.pageId, page.id), eq(pageVersion.version, wanted)))
    .limit(1);
  if (!row) return null;
  return { slug: page.slug, title: page.title, version: wanted, body: row.body, ...authorFields(row.authorName, row.agent), createdAt: row.createdAt, versions };
}

/**
 * Returns a version of a project page (the latest when `version` is omitted). With `since`, the
 * body is left out and the result holds the unified diff from that older version. Viewer or higher.
 *
 * @throws NotFoundError for an unknown page or version
 * @throws InvalidError when `since` is not lower than the resolved version
 */
export async function getPage(db: Executor, actor: Actor, projectSlug: string, pageSlug: string, version?: number): Promise<PageView>;
export async function getPage(db: Executor, actor: Actor, projectSlug: string, pageSlug: string, version: number | undefined, since: number): Promise<PageChanges>;
export async function getPage(db: Executor, actor: Actor, projectSlug: string, pageSlug: string, version?: number, since?: number): Promise<PageView | PageChanges> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const page = await findPage(db, project.id, pageSlug);
  if (!page) throw new NotFoundError(`Unknown page ${pageSlug}.`);
  const found = await loadVersion(db, page, version);
  if (!found) throw new NotFoundError(`Page ${pageSlug} has no version ${version}.`);
  if (since === undefined) return found;
  if (since >= found.version) throw new InvalidError("since must be lower than the version.");
  const older = await loadVersion(db, page, since);
  if (!older) throw new NotFoundError(`Page ${pageSlug} has no version ${since}.`);
  const { body, ...rest } = found;
  return { ...rest, since, diff: unifiedDiff(older.body, body, `page v${since}`, `page v${found.version}`) };
}

/**
 * Compares two versions of a page line by line. Viewer or higher.
 *
 * @throws InvalidError when `from` is not lower than `to`
 * @throws NotFoundError for an unknown page or version
 */
export async function comparePages(db: Executor, actor: Actor, projectSlug: string, pageSlug: string, from: number, to: number): Promise<PageComparison> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const page = await findPage(db, project.id, pageSlug);
  if (!page) throw new NotFoundError(`Unknown page ${pageSlug}.`);
  if (from >= to) throw new InvalidError("from must be lower than to.");
  const [older, newer] = await Promise.all([loadVersion(db, page, from), loadVersion(db, page, to)]);
  if (!older) throw new NotFoundError(`Page ${pageSlug} has no version ${from}.`);
  if (!newer) throw new NotFoundError(`Page ${pageSlug} has no version ${to}.`);
  return { from: older, to: newer, ...diffDocuments(older.body, newer.body) };
}

/**
 * Creates the page when the slug is unknown (a title is then required), otherwise appends its next
 * version and renames it when `title` differs. With `baseVersion`, the write is refused when the
 * page has moved on. Editor or higher.
 *
 * @throws InvalidError for a new page without a title
 * @throws ConflictError when `baseVersion` is not the latest version
 */
export async function writePage(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof writePageInput>): Promise<{ version: number; created: boolean }> {
  const input = writePageInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    let page = await findPage(tx, project.id, input.page, true);
    if (!page) {
      // Two writers creating the same slug serialise on the project row; the loser then finds the page.
      await lockProject(tx, project.id);
      page = await findPage(tx, project.id, input.page, true);
    }
    const entry = { projectId: project.id, entity: "page" };
    const stamp = { authorUserId: actor.userId, agent: actor.agent ?? null };
    if (!page) {
      if (!input.title) throw new InvalidError("title is required for a new page.");
      const [{ last }] = await tx.select({ last: max(projectPage.sortOrder) }).from(projectPage).where(eq(projectPage.projectId, project.id));
      const id = newId();
      await tx.insert(projectPage).values({ id, projectId: project.id, slug: input.page, title: input.title, sortOrder: (last ?? -1) + 1 });
      await tx.insert(pageVersion).values({ id: newId(), pageId: id, version: 1, body: input.body, ...stamp });
      await logChange(tx, actor, { ...entry, entityId: id, field: "created", newValue: input.title });
      return { version: 1, created: true };
    }
    const [{ last }] = await tx.select({ last: max(pageVersion.version) }).from(pageVersion).where(eq(pageVersion.pageId, page.id));
    const latest = last ?? 0;
    if (input.baseVersion !== undefined && input.baseVersion !== latest) {
      throw new ConflictError(`Page ${page.slug} changed since you opened it (now v${latest}). Copy your text, reload and apply it again.`);
    }
    const version = latest + 1;
    await tx.insert(pageVersion).values({ id: newId(), pageId: page.id, version, body: input.body, ...stamp });
    if (input.title && input.title !== page.title) {
      await tx.update(projectPage).set({ title: input.title }).where(eq(projectPage.id, page.id));
      await logChange(tx, actor, { ...entry, entityId: page.id, field: "title", oldValue: page.title, newValue: input.title });
    }
    await logChange(tx, actor, { ...entry, entityId: page.id, field: "version", newValue: `v${version}` });
    return { version, created: false };
  });
}

/**
 * Deletes a page with all its versions and logs it. Owner only.
 *
 * @throws NotFoundError for an unknown page
 */
export async function deletePage(db: Db, actor: Actor, projectSlug: string, pageSlug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const page = await findPage(tx, project.id, pageSlug, true);
    if (!page) throw new NotFoundError(`Unknown page ${pageSlug}.`);
    await tx.delete(projectPage).where(eq(projectPage.id, page.id));
    await logChange(tx, actor, { projectId: project.id, entity: "page", entityId: page.id, field: "deleted", oldValue: page.title });
  });
}
