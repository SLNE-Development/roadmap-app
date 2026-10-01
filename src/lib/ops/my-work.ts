import { and, desc, eq, gt, inArray, isNotNull, isNull, max, ne, or, sql } from "drizzle-orm";
import {
  adr,
  adrSystem,
  allowedAccount,
  boardColumn,
  changeLog,
  notification,
  planningItem,
  planningRound,
  project,
  projectMember,
  question,
  system,
  task,
  user,
} from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { describeChange } from "@/components/activity/change-sentence";
import { formatAdrNumber } from "@/lib/adr-number";
import { plural } from "@/lib/text";
import type { Actor } from "./actor";
import { getPref, setPref } from "./prefs";

/** What kind of thing is waiting on someone. */
export type MyWorkKind = "task" | "planning" | "question" | "decision" | "mention" | "change";

/** One row of the My work inbox. */
export interface MyWorkItem {
  key: string;
  kind: MyWorkKind;
  /** `waiting` needs the person to act; `changes` is news since they last looked. */
  section: "waiting" | "changes";
  projectSlug: string;
  projectName: string;
  systemSlug: string | null;
  title: string;
  detail: string;
  href: string;
  at: Date;
  agent: string | null;
  authorName: string | null;
}

/** The preference holding when the actor last marked their changes seen, as an ISO string. */
export const MY_WORK_SEEN_PREF = "mywork.seenAt";

const DAY_MS = 86_400_000;
/** How far back unread mentions count as waiting. */
const MENTION_DAYS = 14;
const DEFAULT_CHANGES = 30;
const MAX_CHANGES = 100;

/** Returns when the actor last marked My work seen, or `null`. */
export async function myWorkSeenAt(db: Executor, actor: Actor): Promise<Date | null> {
  const value = await getPref(db, actor.userId, MY_WORK_SEEN_PREF);
  const at = typeof value === "string" ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/** Stores `at` as the time the actor last saw their changes. Not logged: it is personal. */
export function markMyWorkSeen(db: Db, actor: Actor, at: Date): Promise<void> {
  return setPref(db, actor, MY_WORK_SEEN_PREF, at.toISOString());
}

/**
 * Lists what is waiting on the actor, then what changed on their systems.
 * Only projects where the actor has an active membership count (an admin who
 * is not a member sees nothing of that project), and archived projects and
 * systems are left out. Waiting items come first: the actor's blocked then
 * in-progress tasks, open planning items, questions and proposed ADRs on
 * their systems, and their unread mentions of the last 14 days; then up to `changesLimit` changes newer than the seen time
 * (or the last 7 days), newest first.
 *
 * @param opts.now the reference time for the default change window
 * @param opts.changesLimit most changes returned; 30 by default, 100 at most
 */
export async function myWork(db: Executor, actor: Actor, opts: { now: Date; changesLimit?: number }): Promise<MyWorkItem[]> {
  const projects = await db
    .select({ id: project.id, slug: project.slug, name: project.name })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(and(eq(projectMember.userId, actor.userId), isNull(project.archivedAt)));
  if (projects.length === 0) return [];
  const projectIds = projects.map((p) => p.id);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const slugOf = (projectId: string) => byId.get(projectId)?.slug ?? "";
  const nameOf = (projectId: string) => byId.get(projectId)?.name ?? "";

  const seenAt = await myWorkSeenAt(db, actor);
  const since = seenAt ?? new Date(opts.now.getTime() - 7 * DAY_MS);
  const limit = Math.min(Math.max(opts.changesLimit ?? DEFAULT_CHANGES, 1), MAX_CHANGES);

  const owned = await db
    .select({ id: system.id, slug: system.slug, title: system.title, projectId: system.projectId, category: boardColumn.category })
    .from(system)
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .where(and(eq(system.ownerUserId, actor.userId), inArray(system.projectId, projectIds), isNull(system.archivedAt)));
  const ownedIds = owned.map((s) => s.id);
  const ownedById = new Map(owned.map((s) => [s.id, s]));
  const planningIds = owned.filter((s) => s.category === "planning").map((s) => s.id);

  const [taskRows, roundRows, questionRows, askedRows, adrRows, changeRows, mentionRows] = await Promise.all([
    db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        reason: task.blockedReason,
        systemSlug: system.slug,
        systemTitle: system.title,
        projectId: system.projectId,
        systemCreatedAt: system.createdAt,
      })
      .from(task)
      .innerJoin(system, eq(system.id, task.systemId))
      .where(
        and(
          eq(task.ownerUserId, actor.userId),
          inArray(task.state, ["blocked", "doing"]),
          inArray(system.projectId, projectIds),
          isNull(system.archivedAt),
        ),
      ),
    planningIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            systemId: planningRound.systemId,
            number: planningRound.number,
            createdAt: planningRound.createdAt,
            agent: planningRound.agent,
            authorName: user.name,
            open: sql<number>`count(${planningItem.id}) filter (where ${planningItem.status} = 'open')`.mapWith(Number),
          })
          .from(planningRound)
          .leftJoin(planningItem, eq(planningItem.roundId, planningRound.id))
          .leftJoin(user, eq(user.id, planningRound.authorUserId))
          .where(inArray(planningRound.systemId, planningIds))
          .groupBy(planningRound.id, user.name),
    ownedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: question.id,
            title: question.title,
            priority: question.priority,
            systemId: question.systemId,
            createdAt: question.createdAt,
            agent: question.agent,
            authorName: user.name,
          })
          .from(question)
          .leftJoin(user, eq(user.id, question.authorUserId))
          .where(
            and(
              eq(question.resolved, false),
              inArray(question.systemId, ownedIds),
              or(isNull(question.authorUserId), ne(question.authorUserId, actor.userId), isNotNull(question.agent)),
            ),
          ),
    db
      .select({
        id: question.id,
        title: question.title,
        priority: question.priority,
        projectId: question.projectId,
        systemSlug: system.slug,
        answeredAt: question.answeredAt,
        answeredAgent: question.answeredAgent,
        answeredBy: user.name,
      })
      .from(question)
      .leftJoin(system, eq(system.id, question.systemId))
      .leftJoin(user, eq(user.id, question.answeredByUserId))
      .where(
        and(
          eq(question.resolved, false),
          eq(question.authorUserId, actor.userId),
          isNull(question.agent),
          inArray(question.projectId, projectIds),
          isNotNull(question.answeredAt),
          gt(question.answeredAt, since),
          or(isNull(question.systemId), isNull(system.archivedAt)),
        ),
      ),
    ownedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: adr.id,
            number: adr.number,
            title: adr.title,
            createdAt: adr.createdAt,
            agent: adr.agent,
            authorName: user.name,
            projectId: adr.projectId,
            systemId: adrSystem.systemId,
          })
          .from(adr)
          .innerJoin(adrSystem, eq(adrSystem.adrId, adr.id))
          .leftJoin(user, eq(user.id, adr.authorUserId))
          .where(and(eq(adr.status, "proposed"), inArray(adrSystem.systemId, ownedIds)))
          .orderBy(adr.number),
    ownedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: changeLog.id,
            projectId: changeLog.projectId,
            systemId: changeLog.systemId,
            entity: changeLog.entity,
            entityId: changeLog.entityId,
            field: changeLog.field,
            oldValue: changeLog.oldValue,
            newValue: changeLog.newValue,
            createdAt: changeLog.createdAt,
            agent: changeLog.agent,
            authorName: user.name,
          })
          .from(changeLog)
          .leftJoin(user, eq(user.id, changeLog.authorUserId))
          .where(
            and(
              inArray(changeLog.systemId, ownedIds),
              gt(changeLog.createdAt, since),
              or(isNull(changeLog.authorUserId), ne(changeLog.authorUserId, actor.userId), isNotNull(changeLog.agent)),
            ),
          )
          .orderBy(desc(changeLog.createdAt), desc(changeLog.id))
          .limit(limit),
    db
      .select({
        id: notification.id,
        projectId: notification.projectId,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(
        and(
          eq(notification.userId, actor.userId),
          eq(notification.kind, "mention"),
          eq(notification.inInbox, true),
          isNull(notification.readAt),
          inArray(notification.projectId, projectIds),
          gt(notification.createdAt, new Date(opts.now.getTime() - MENTION_DAYS * DAY_MS)),
        ),
      )
      .orderBy(desc(notification.createdAt), desc(notification.id)),
  ]);

  const stateSince = new Map<string, Date>();
  if (taskRows.length > 0) {
    const rows = await db
      .select({ entityId: changeLog.entityId, at: max(changeLog.createdAt) })
      .from(changeLog)
      .where(
        and(
          inArray(changeLog.projectId, projectIds),
          eq(changeLog.entity, "task"),
          eq(changeLog.field, "state"),
          inArray(changeLog.entityId, taskRows.map((t) => String(t.id))),
        ),
      )
      .groupBy(changeLog.entityId);
    for (const r of rows) if (r.at) stateSince.set(r.entityId, r.at);
  }

  const item = (p: string, rest: Omit<MyWorkItem, "projectSlug" | "projectName" | "agent" | "authorName"> & Partial<MyWorkItem>): MyWorkItem => ({
    projectSlug: slugOf(p),
    projectName: nameOf(p),
    agent: null,
    authorName: null,
    ...rest,
  });

  const tasks = taskRows
    .sort((a, b) => (a.state === b.state ? a.id - b.id : a.state === "blocked" ? -1 : 1))
    .map((t) =>
      item(t.projectId, {
        key: `task-${t.id}`,
        kind: "task",
        section: "waiting",
        systemSlug: t.systemSlug,
        title: `#${t.id} ${t.title}`,
        detail: t.state === "blocked" ? `${t.systemTitle} · blocked: ${t.reason ?? "no reason given"}` : `${t.systemTitle} · in progress`,
        href: `/p/${slugOf(t.projectId)}/systems/${t.systemSlug}`,
        at: stateSince.get(String(t.id)) ?? t.systemCreatedAt,
      }),
    );

  const latestRound = new Map<string, (typeof roundRows)[number]>();
  for (const r of roundRows) {
    const known = latestRound.get(r.systemId);
    if (!known || r.number > known.number) latestRound.set(r.systemId, r);
  }
  const planning = [...latestRound.values()]
    .filter((r) => r.open > 0)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => {
      const s = ownedById.get(r.systemId)!;
      return item(s.projectId, {
        key: `planning-${r.systemId}-${r.number}`,
        kind: "planning",
        section: "waiting",
        systemSlug: s.slug,
        title: `Planning round ${r.number} has ${plural(r.open, "open item")}`,
        detail: s.title,
        href: `/p/${slugOf(s.projectId)}/systems/${s.slug}?tab=planning`,
        at: r.createdAt,
        agent: r.agent,
        authorName: r.authorName,
      });
    });

  const rank = { blocking: 0, normal: 1, nice: 2 } as const;
  const questions = [
    ...questionRows.map((q) => {
      const s = ownedById.get(q.systemId!)!;
      return {
        priority: q.priority,
        at: q.createdAt,
        row: item(s.projectId, {
          key: `question-${q.id}`,
          kind: "question",
          section: "waiting",
          systemSlug: s.slug,
          title: q.title,
          detail: `${q.priority === "blocking" ? "Blocking · " : ""}${s.title}`,
          href: `/p/${slugOf(s.projectId)}/questions?system=${s.slug}`,
          at: q.createdAt,
          agent: q.agent,
          authorName: q.authorName,
        }),
      };
    }),
    ...askedRows.map((q) => ({
      priority: q.priority,
      at: q.answeredAt!,
      row: item(q.projectId, {
        key: `question-${q.id}`,
        kind: "question",
        section: "waiting",
        systemSlug: q.systemSlug,
        title: q.title,
        detail: "Answered, waiting for you to resolve",
        href: q.systemSlug ? `/p/${slugOf(q.projectId)}/questions?system=${q.systemSlug}` : `/p/${slugOf(q.projectId)}/questions`,
        at: q.answeredAt!,
        agent: q.answeredAgent,
        authorName: q.answeredBy,
      }),
    })),
  ]
    .sort((a, b) => rank[a.priority] - rank[b.priority] || b.at.getTime() - a.at.getTime())
    .map((q) => q.row);

  const seenAdrs = new Set<string>();
  const decisions: MyWorkItem[] = [];
  for (const a of adrRows) {
    if (seenAdrs.has(a.id)) continue;
    seenAdrs.add(a.id);
    const s = ownedById.get(a.systemId)!;
    decisions.push(
      item(a.projectId, {
        key: `decision-${a.id}`,
        kind: "decision",
        section: "waiting",
        systemSlug: s.slug,
        title: `ADR-${formatAdrNumber(a.number)} ${a.title}`,
        detail: `Proposed · ${s.title}`,
        href: `/p/${slugOf(a.projectId)}/adrs/${a.number}`,
        at: a.createdAt,
        agent: a.agent,
        authorName: a.authorName,
      }),
    );
  }

  const mentions = mentionRows.map((m) =>
    item(m.projectId, {
      key: `mention-${m.id}`,
      kind: "mention",
      section: "waiting",
      systemSlug: null,
      title: m.title,
      detail: m.body,
      href: m.href,
      at: m.createdAt,
    }),
  );

  const changes = changeRows.map((c) => {
    const s = c.systemId ? ownedById.get(c.systemId) : undefined;
    const { verb, target, suffix, from, to } = describeChange(c, { systemTitle: s?.title ?? null });
    const sentence = [verb, target, suffix, from !== undefined && to !== undefined ? `${from} → ${to}` : to].filter(Boolean).join(" ");
    return item(c.projectId, {
      key: `change-${c.id}`,
      kind: "change",
      section: "changes",
      systemSlug: s?.slug ?? null,
      title: sentence,
      detail: `${s?.title ?? ""} · ${nameOf(c.projectId)}`,
      href: s ? `/p/${slugOf(c.projectId)}/systems/${s.slug}` : `/p/${slugOf(c.projectId)}/activity`,
      at: c.createdAt,
      agent: c.agent,
      authorName: c.authorName,
    });
  });

  return [...tasks, ...planning, ...questions, ...decisions, ...mentions, ...changes];
}
