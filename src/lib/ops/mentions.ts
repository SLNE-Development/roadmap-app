import { eq } from "drizzle-orm";
import { allowedAccount, projectMember, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { resolveMentionNames, type MentionMember } from "@/lib/mentions";
import type { Actor } from "./actor";

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

/** Notifies each newly mentioned user except the actor. */
export async function notifyMentions(tx: Executor, actor: Actor, input: MentionNotice): Promise<void> {
  // Task 2 completes this: `notify` per id from `newMentions`, excluding the actor.
  void [tx, actor, input];
}
