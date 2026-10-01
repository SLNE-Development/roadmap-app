import { and, desc, eq, gt, ne } from "drizzle-orm";
import { session } from "@/db/schema";
import type { Executor } from "@/db/types";
import { parseUserAgent } from "@/lib/user-agent";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** A signed-in session as shown to its owner: never the token. */
export interface SessionRow {
  id: string;
  /** The browser and system the session was made with; null when unknown. */
  browser: string | null;
  system: string | null;
  ip: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  /** Whether this is the session making the request. */
  current: boolean;
}

/** The actor's unexpired sessions: the current one first, then the most recently active. */
export async function listSessions(db: Executor, actor: Actor, currentSessionId: string | null): Promise<SessionRow[]> {
  const rows = await db
    .select()
    .from(session)
    .where(and(eq(session.userId, actor.userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt));
  return rows
    .map((s) => ({ id: s.id, ...parseUserAgent(s.userAgent), ip: s.ipAddress, createdAt: s.createdAt, lastActiveAt: s.updatedAt, current: s.id === currentSessionId }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * Signs one of the actor's sessions out by deleting it.
 *
 * @throws NotFoundError if the session does not exist or belongs to someone else
 */
export async function endSession(db: Executor, actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(session)
    .where(and(eq(session.id, id), eq(session.userId, actor.userId)))
    .returning({ id: session.id });
  if (deleted.length === 0) throw new NotFoundError(`Unknown session ${id}.`);
}

/** Signs the actor out everywhere except the current session and reports how many sessions ended. */
export async function endOtherSessions(db: Executor, actor: Actor, currentSessionId: string | null): Promise<{ ended: number }> {
  const where = currentSessionId ? and(eq(session.userId, actor.userId), ne(session.id, currentSessionId)) : eq(session.userId, actor.userId);
  const deleted = await db.delete(session).where(where).returning({ id: session.id });
  return { ended: deleted.length };
}
