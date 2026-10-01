import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { adr, adrSystem, boardColumn, changeLog, notification, project, question, system, task, user, type NotificationKind } from "@/db/schema";
import { formatAdrNumber } from "@/lib/adr-number";
import { actorLabel, inMovedColumn, notify } from "@/lib/ops/notifications";
import type { WorkerDeps } from "../deps";
import { registerFeedConsumer, type ChangeEvent } from "../feed";

/**
 * Kinds that also reach the author when their own agent made the change, because the agent needs them.
 *
 * One notice per action: when the same write also mentioned a recipient (a `mention` row for the event's entity,
 * created in the same transaction, so with the same `now()` as the change-log entry), the mention is kept and
 * this consumer leaves that recipient out.
 */
export const SELF_AGENT_KINDS: NotificationKind[] = ["question.asked", "planning.round", "task.blocked", "system.blocked"];

const MAX_INT = 2147483647;

/** What the batch's events point at, in its current state, loaded once per batch. */
interface Context {
  slugs: Map<string, string>;
  names: Map<string, string>;
  systems: Map<string, { slug: string; title: string; ownerUserId: string | null; ownerName: string | null; columnName: string; category: string }>;
  tasks: Map<number, { systemId: string; title: string; ownerUserId: string | null; ownerName: string | null }>;
  questions: Map<string, { systemId: string | null; title: string; priority: string; authorUserId: string | null }>;
  adrs: Map<string, { number: number; title: string; systemIds: string[] }>;
}

/** A notice for one event before the self rule: its kind, candidate recipients and content. */
interface Draft {
  kind: NotificationKind;
  recipients: (string | null)[];
  title: string;
  body?: string;
  href: string;
}

type Rule = (event: ChangeEvent, ctx: Context, base: string) => Draft | null;

/** Parses a task id from a change-log entity id, or returns `null`. */
function taskId(event: ChangeEvent): number | null {
  const id = Number(event.entityId);
  return Number.isInteger(id) && id > 0 && id <= MAX_INT ? id : null;
}

const RULES: Record<string, Rule> = {
  "question/answer": (event, ctx, base) => {
    const q = ctx.questions.get(event.entityId);
    if (event.newValue === null || !q) return null;
    const actor = actorLabel(ctx.names.get(event.authorUserId ?? ""), event.agent);
    return { kind: "question.answered", recipients: [q.authorUserId], title: `${actor} answered your question`, body: q.title, href: `${base}/questions#q-${event.entityId}` };
  },
  "question/created": (event, ctx, base) => {
    const q = ctx.questions.get(event.entityId);
    // The question's system now, in case it moved since it was asked.
    const sys = q?.systemId ? ctx.systems.get(q.systemId) : undefined;
    if (!q || !sys) return null;
    const title = `${q.priority === "blocking" ? "Blocking question" : "New question"} on ${sys.title}`;
    return { kind: "question.asked", recipients: [sys.ownerUserId], title, body: q.title, href: `${base}/questions#q-${event.entityId}` };
  },
  "planning/round": (event, ctx, base) => {
    const sys = event.systemId ? ctx.systems.get(event.systemId) : undefined;
    if (!sys) return null;
    return {
      kind: "planning.round",
      recipients: [sys.ownerUserId],
      title: `Planning questions on ${sys.title}`,
      body: event.newValue ?? undefined,
      href: `${base}/systems/${sys.slug}?tab=planning`,
    };
  },
  "system/owner": (event, ctx, base) => {
    const sys = ctx.systems.get(event.entityId);
    if (event.newValue === null || !sys || sys.ownerName !== event.newValue) return null;
    return { kind: "system.assigned", recipients: [sys.ownerUserId], title: `You own ${sys.title}`, href: `${base}/systems/${sys.slug}` };
  },
  "task/owner": (event, ctx, base) => {
    const id = taskId(event);
    const t = id === null ? undefined : ctx.tasks.get(id);
    const sys = t && ctx.systems.get(t.systemId);
    if (event.newValue === null || !t || !sys || t.ownerName !== event.newValue) return null;
    return { kind: "task.assigned", recipients: [t.ownerUserId], title: `Task #${id} is yours: ${t.title}`, href: `${base}/systems/${sys.slug}#task-${id}` };
  },
  "task/state": (event, ctx, base) => {
    const id = taskId(event);
    const t = id === null ? undefined : ctx.tasks.get(id);
    const sys = t && ctx.systems.get(t.systemId);
    if (event.newValue !== "blocked" || !t || !sys) return null;
    return { kind: "task.blocked", recipients: [sys.ownerUserId, t.ownerUserId], title: `Task #${id} is blocked`, body: t.title, href: `${base}/systems/${sys.slug}#task-${id}` };
  },
  "system/column": (event, ctx, base) => {
    const sys = ctx.systems.get(event.entityId);
    // The system must still be in the column the event moved it to.
    if (!sys || !inMovedColumn(event.newValue, sys.columnName)) return null;
    if (sys.category !== "blocked" && sys.category !== "done") return null;
    const kind = sys.category === "blocked" ? "system.blocked" : "system.done";
    return { kind, recipients: [sys.ownerUserId], title: `${sys.title} is ${sys.category}`, href: `${base}/systems/${sys.slug}` };
  },
  "adr/created": (event, ctx, base) => {
    const a = ctx.adrs.get(event.entityId);
    if (!a) return null;
    return {
      kind: "adr.proposed",
      recipients: a.systemIds.map((id) => ctx.systems.get(id)?.ownerUserId ?? null),
      title: `ADR-${formatAdrNumber(a.number)} proposed: ${a.title}`,
      href: `${base}/adrs/${a.number}`,
    };
  },
  "update/posted": (event, ctx, base) => {
    const sys = event.systemId ? ctx.systems.get(event.systemId) : undefined;
    if (!sys) return null;
    return { kind: "update.posted", recipients: [sys.ownerUserId], title: `Update on ${sys.title}`, body: event.newValue ?? undefined, href: `${base}/systems/${sys.slug}` };
  },
};

const taskOwner = alias(user, "task_owner");

/** Loads the current state of everything the events point at, with one query per table. */
async function loadContext(events: ChangeEvent[], deps: WorkerDeps): Promise<Context> {
  const { db } = deps;
  const of = (entity: string) => [...new Set(events.filter((e) => e.entity === entity).map((e) => e.entityId))];
  const taskIds = [...new Set(events.filter((e) => e.entity === "task").map(taskId))].filter((id): id is number => id !== null);
  const questionIds = of("question");
  const adrIds = of("adr");

  const [taskRows, questionRows, adrRows] = await Promise.all([
    taskIds.length
      ? db
          .select({ id: task.id, systemId: task.systemId, title: task.title, ownerUserId: task.ownerUserId, ownerName: taskOwner.name })
          .from(task)
          .leftJoin(taskOwner, eq(taskOwner.id, task.ownerUserId))
          .where(inArray(task.id, taskIds))
      : [],
    questionIds.length
      ? db
          .select({ id: question.id, systemId: question.systemId, title: question.title, priority: question.priority, authorUserId: question.authorUserId })
          .from(question)
          .where(inArray(question.id, questionIds))
      : [],
    adrIds.length
      ? db
          .select({ id: adr.id, number: adr.number, title: adr.title, systemId: adrSystem.systemId })
          .from(adr)
          .leftJoin(adrSystem, eq(adrSystem.adrId, adr.id))
          .where(inArray(adr.id, adrIds))
      : [],
  ]);

  const adrs: Context["adrs"] = new Map();
  for (const row of adrRows) {
    const entry = adrs.get(row.id) ?? { number: row.number, title: row.title, systemIds: [] };
    if (row.systemId) entry.systemIds.push(row.systemId);
    adrs.set(row.id, entry);
  }

  const systemIds = new Set<string>();
  for (const e of events) {
    if (e.systemId) systemIds.add(e.systemId);
    if (e.entity === "system") systemIds.add(e.entityId);
  }
  for (const row of taskRows) systemIds.add(row.systemId);
  for (const row of questionRows) if (row.systemId) systemIds.add(row.systemId);
  for (const a of adrs.values()) for (const id of a.systemIds) systemIds.add(id);
  const projectIds = [...new Set(events.map((e) => e.projectId))];
  const authorIds = [...new Set(events.map((e) => e.authorUserId).filter((id): id is string => id !== null))];

  const [systemRows, projectRows, authorRows] = await Promise.all([
    systemIds.size
      ? db
          .select({
            id: system.id,
            slug: system.slug,
            title: system.title,
            ownerUserId: system.ownerUserId,
            ownerName: user.name,
            columnName: boardColumn.name,
            category: boardColumn.category,
          })
          .from(system)
          .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
          .leftJoin(user, eq(user.id, system.ownerUserId))
          .where(inArray(system.id, [...systemIds]))
      : [],
    db.select({ id: project.id, slug: project.slug }).from(project).where(inArray(project.id, projectIds)),
    authorIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, authorIds)) : [],
  ]);

  return {
    slugs: new Map(projectRows.map((r) => [r.id, r.slug])),
    names: new Map(authorRows.map((r) => [r.id, r.name])),
    systems: new Map(systemRows.map(({ id, ...rest }) => [id, rest])),
    tasks: new Map(taskRows.map(({ id, ...rest }) => [id, rest])),
    questions: new Map(questionRows.map(({ id, ...rest }) => [id, rest])),
    adrs,
  };
}

/**
 * Returns `<change id>:<user id>` for every recipient the same write already mentioned: a `mention` row for the
 * event's entity created at the change-log entry's time, compared in SQL to keep the microseconds.
 */
async function mentionedBy(deps: WorkerDeps, changeIds: number[], userIds: string[]): Promise<Set<string>> {
  if (changeIds.length === 0 || userIds.length === 0) return new Set();
  const rows = await deps.db
    .select({ changeId: changeLog.id, userId: notification.userId })
    .from(notification)
    .innerJoin(
      changeLog,
      and(eq(changeLog.entity, notification.entity), eq(changeLog.entityId, notification.entityId), eq(changeLog.createdAt, notification.createdAt)),
    )
    .where(and(inArray(changeLog.id, changeIds), inArray(notification.userId, userIds), eq(notification.kind, "mention")));
  return new Set(rows.map((r) => `${r.changeId}:${r.userId}`));
}

/**
 * Turns change-log entries into notifications for system and task owners, askers and the
 * owners of systems an ADR concerns. Idempotent: each recipient gets one notice per entry.
 * A recipient the same write mentioned keeps only the mention.
 */
export async function handleNotificationEvents(events: ChangeEvent[], deps: WorkerDeps): Promise<void> {
  const relevant = events.filter((e) => RULES[`${e.entity}/${e.field}`]);
  if (relevant.length === 0) return;
  const ctx = await loadContext(relevant, deps);
  const planned: { event: ChangeEvent; draft: Draft; recipients: string[] }[] = [];
  for (const event of relevant) {
    const slug = ctx.slugs.get(event.projectId);
    const draft = slug ? RULES[`${event.entity}/${event.field}`](event, ctx, `/p/${slug}`) : null;
    if (!draft) continue;
    const selfToo = event.agent !== null && SELF_AGENT_KINDS.includes(draft.kind);
    const recipients = [...new Set(draft.recipients)].filter((id): id is string => id !== null && (selfToo || id !== event.authorUserId));
    if (recipients.length > 0) planned.push({ event, draft, recipients });
  }
  const mentioned = await mentionedBy(
    deps,
    planned.map((p) => p.event.id),
    [...new Set(planned.flatMap((p) => p.recipients))],
  );
  for (const { event, draft, recipients: all } of planned) {
    const recipients = all.filter((id) => !mentioned.has(`${event.id}:${id}`));
    if (recipients.length === 0) continue;
    const actorName = actorLabel(ctx.names.get(event.authorUserId ?? ""), event.agent);
    await deps.db.transaction(async (tx) => {
      for (const userId of recipients) {
        await notify(tx, {
          userId,
          projectId: event.projectId,
          kind: draft.kind,
          entity: event.entity,
          entityId: event.entityId,
          title: draft.title,
          body: draft.body,
          href: draft.href,
          actorName,
          sourceKey: `cl:${event.id}`,
        });
      }
    });
  }
}

registerFeedConsumer("notifications", handleNotificationEvents);
