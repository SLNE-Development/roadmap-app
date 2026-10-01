import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { system } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

/** The least trigram similarity (0 to 1) at which two titles count as similar. */
export const SIMILARITY_THRESHOLD = 0.35;

/** Input of {@link similarSystems}. */
export const similarSystemsInput = z.object({
  title: z.string().trim().min(3).max(120),
  limit: z.number().int().min(1).max(10).default(3),
});

/** An existing system whose title resembles a candidate title. */
export interface SimilarSystem {
  slug: string;
  title: string;
  score: number;
  archived: boolean;
}

/** Lists the project's systems with a title similar to `raw.title`, best match first. Archived ones are included and flagged, since they hold their slug too. Viewer or higher. */
export async function similarSystems(db: Executor, actor: Actor, projectSlug: string, raw: z.input<typeof similarSystemsInput>): Promise<SimilarSystem[]> {
  const input = similarSystemsInput.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const score = sql<number>`similarity(lower(${system.title}), lower(${input.title}))`;
  const rows = await db
    .select({ slug: system.slug, title: system.title, score, archivedAt: system.archivedAt })
    .from(system)
    .where(and(eq(system.projectId, project.id), sql`${score} >= ${SIMILARITY_THRESHOLD}`))
    .orderBy(desc(score), system.slug)
    .limit(input.limit);
  return rows.map((r) => ({ slug: r.slug, title: r.title, score: Number(r.score), archived: r.archivedAt !== null }));
}
