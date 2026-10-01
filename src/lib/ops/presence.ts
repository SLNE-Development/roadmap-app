import { and, eq, gt, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { agentCall, agentRun, system, user } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Kv } from "@/lib/kv";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { findBoard, findSystem } from "./lookup";

/** How long a heartbeat keeps a person listed, and the TTL of the Valkey hash. */
export const PRESENCE_TTL_SECONDS = 60;
/** How recent an agent call must be for the agent to count as present. */
export const AGENT_PRESENCE_MS = 120_000;

/** A person viewing a system. */
export interface PresentPerson {
  userId: string;
  name: string;
  /** ISO time of their last heartbeat. */
  at: string;
}

/** An agent that called tools on a system recently, on behalf of `userId`. */
export interface PresentAgent {
  userId: string;
  name: string;
  agent: string;
  /** ISO time of its latest call. */
  at: string;
}

export interface SystemPresence {
  people: PresentPerson[];
  agents: PresentAgent[];
}

const presenceKey = (systemId: string) => `presence:${systemId}`;

/** Parses a stored heartbeat; null when malformed or 60 s old or older (a leave marker is dated 1970, so it is always stale). */
function parseFresh(raw: string, now: Date): { name: string; at: string } | null {
  try {
    const value = JSON.parse(raw) as { name?: unknown; at?: unknown };
    if (typeof value.name !== "string" || typeof value.at !== "string") return null;
    return now.getTime() - Date.parse(value.at) < PRESENCE_TTL_SECONDS * 1000 ? { name: value.name, at: value.at } : null;
  } catch {
    return null;
  }
}

function peopleOf(hash: Record<string, string>, actor: Actor, now: Date): PresentPerson[] {
  const people: PresentPerson[] = [];
  for (const [userId, raw] of Object.entries(hash)) {
    if (userId === actor.userId) continue;
    const fresh = parseFresh(raw, now);
    if (fresh) people.push({ userId, ...fresh });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/**
 * Records that the actor views (or, with `leaving`, left) a system.
 * Presence is not content: no transaction, no change log.
 *
 * @returns whether the set of viewers changed, and the project id for publishing
 * @throws NotFoundError if the project or system is not visible
 */
export async function heartbeat(
  db: Db,
  kv: Kv,
  actor: Actor,
  input: { project: string; system: string; leaving?: boolean },
  now: Date,
): Promise<{ changed: boolean; projectId: string }> {
  const { project } = await projectAccess(db, actor, input.project, "viewer");
  const sys = await findSystem(db, project.id, input.system);
  const key = presenceKey(sys.id);
  const previous = (await kv.hgetall(key))[actor.userId];
  const wasPresent = previous !== undefined && parseFresh(previous, now) !== null;
  // Kv has no field delete, so leaving writes a marker that is always stale.
  const at = input.leaving ? new Date(0) : now;
  await kv.hset(key, actor.userId, JSON.stringify({ name: actor.name, at: at.toISOString() }), PRESENCE_TTL_SECONDS);
  return { changed: input.leaving ? true : !wasPresent, projectId: project.id };
}

/** Returns the agents that called tools on the given systems in the last {@link AGENT_PRESENCE_MS}, by system slug. */
async function agentsOf(db: Db, projectId: string, slugs: string[], now: Date): Promise<Map<string, PresentAgent[]>> {
  const result = new Map<string, PresentAgent[]>();
  if (slugs.length === 0) return result;
  const rows = await db
    .select({ systemSlug: agentCall.systemSlug, userId: agentRun.userId, name: user.name, agent: agentCall.agent, at: max(agentCall.at) })
    .from(agentCall)
    .innerJoin(agentRun, eq(agentRun.id, agentCall.runId))
    .innerJoin(user, eq(user.id, agentRun.userId))
    .where(
      and(
        eq(agentCall.projectId, projectId),
        inArray(agentCall.systemSlug, slugs),
        isNotNull(agentCall.agent),
        gt(agentCall.at, new Date(now.getTime() - AGENT_PRESENCE_MS)),
      ),
    )
    .groupBy(agentCall.systemSlug, agentRun.userId, user.name, agentCall.agent)
    .orderBy(user.name, agentCall.agent);
  for (const row of rows) {
    if (!row.systemSlug || !row.agent || !row.at) continue;
    const list = result.get(row.systemSlug) ?? [];
    list.push({ userId: row.userId, name: row.name, agent: row.agent, at: row.at.toISOString() });
    result.set(row.systemSlug, list);
  }
  return result;
}

/**
 * Lists the other people viewing a system and the agents working on it.
 *
 * @throws NotFoundError if the project or system is not visible
 */
export async function systemPresence(
  db: Db,
  kv: Kv,
  actor: Actor,
  input: { project: string; system: string },
  now: Date,
): Promise<SystemPresence> {
  const { project } = await projectAccess(db, actor, input.project, "viewer");
  const sys = await findSystem(db, project.id, input.system);
  const [hash, agents] = await Promise.all([kv.hgetall(presenceKey(sys.id)), agentsOf(db, project.id, [sys.slug], now)]);
  return { people: peopleOf(hash, actor, now), agents: agents.get(sys.slug) ?? [] };
}

/**
 * Lists presence for every active system of a board, keyed by system slug; systems nobody is on are left out.
 *
 * @throws NotFoundError if the project or board is not visible
 */
export async function boardPresence(
  db: Db,
  kv: Kv,
  actor: Actor,
  input: { project: string; board: string },
  now: Date,
): Promise<Record<string, SystemPresence>> {
  const { project } = await projectAccess(db, actor, input.project, "viewer");
  const found = await findBoard(db, project.id, input.board);
  const systems = await db
    .select({ id: system.id, slug: system.slug })
    .from(system)
    .where(and(eq(system.boardId, found.id), eq(system.projectId, project.id), isNull(system.archivedAt)));
  const [hashes, agents] = await Promise.all([
    Promise.all(systems.map((s) => kv.hgetall(presenceKey(s.id)))),
    agentsOf(db, project.id, systems.map((s) => s.slug), now),
  ]);
  const result: Record<string, SystemPresence> = {};
  systems.forEach((s, i) => {
    const entry = { people: peopleOf(hashes[i], actor, now), agents: agents.get(s.slug) ?? [] };
    if (entry.people.length > 0 || entry.agents.length > 0) result[s.slug] = entry;
  });
  return result;
}
