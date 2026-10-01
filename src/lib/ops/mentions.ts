import { asc, eq } from "drizzle-orm";
import { allowedAccount, projectMember, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { newMentions, resolveMentionNames, type MentionMember } from "@/lib/mentions";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { actorLabel, notify } from "./notifications";

/** A project member as the mention picker offers them. */
export interface MentionCandidate extends MentionMember {
  image: string | null;
}

/** Active members of a project (removed accounts left out) as `{ userId, name, image }`, by name. */
async function memberNames(tx: Executor, projectId: string): Promise<MentionCandidate[]> {
  return tx
    .select({ userId: user.id, name: user.name, image: user.image })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(user.name));
}

/** Lists the members a mention in the project can name; any member may read it. */
export async function listMentionMembers(db: Executor, actor: Actor, slug: string): Promise<MentionCandidate[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  return memberNames(db, project.id);
}

/**
 * Turns `@Name` in `text` into mention tokens for the project's current members. Tokens are longer than the names
 * they replace, so when the result would exceed `max` characters the text is kept as written.
 */
export async function resolveMentionsIn(tx: Executor, projectId: string, text: string, max: number): Promise<string> {
  if (!text.includes("@")) return text;
  const resolved = resolveMentionNames(text, await memberNames(tx, projectId));
  return resolved.length > max ? text : resolved;
}

/** Input of {@link notifyMentions}. */
export interface MentionNotice {
  projectId: string;
  before: string | null;
  after: string;
  title: string;
  href: string;
  /** Becomes the notification's source key as `${source}:mention:${userId}`. */
  source: string;
}

/**
 * Notifies each user `after` mentions and `before` did not, except the actor; the body is `after`.
 * The entity and its id are the first two parts of `source`, such as `question:<id>:text`.
 */
export async function notifyMentions(tx: Executor, actor: Actor, input: MentionNotice): Promise<void> {
  const [entity, entityId] = input.source.split(":");
  for (const userId of newMentions(input.before, input.after)) {
    if (userId === actor.userId) continue;
    await notify(tx, {
      userId,
      projectId: input.projectId,
      kind: "mention",
      entity,
      entityId,
      title: input.title,
      body: input.after,
      href: input.href,
      actorName: actorLabel(actor.name, actor.agent),
      sourceKey: `${input.source}:mention:${userId}`,
    });
  }
}
