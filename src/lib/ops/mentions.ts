import { eq } from "drizzle-orm";
import { allowedAccount, projectMember, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { newMentions, resolveMentionNames, type MentionMember } from "@/lib/mentions";
import type { Actor } from "./actor";
import { actorLabel, notify } from "./notifications";

/** Active members of a project (removed accounts left out) as `{ userId, name }`. */
async function memberNames(tx: Executor, projectId: string): Promise<MentionMember[]> {
  return tx
    .select({ userId: user.id, name: user.name })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(projectMember.projectId, projectId));
}

/** Turns `@Name` in `text` into mention tokens for the project's current members. */
export async function resolveMentionsIn(tx: Executor, projectId: string, text: string): Promise<string> {
  if (!text.includes("@")) return text;
  return resolveMentionNames(text, await memberNames(tx, projectId));
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
