import { and, eq, inArray } from "drizzle-orm";
import { adr, adrSystem, boardColumn, discordOutbox, project, projectWebhook, question, system, task, user } from "@/db/schema";
import { formatAdrNumber } from "@/lib/adr-number";
import type { DiscordEvent } from "@/lib/discord-events";
import type { DiscordItem } from "@/lib/discord-format";
import { actorLabel, inMovedColumn } from "@/lib/ops/notifications";
import { siteUrl } from "@/lib/site";
import type { WorkerDeps } from "../deps";
import { registerFeedConsumer, type ChangeEvent } from "../feed";

/** How long changes gather before a webhook's flush posts them. */
const FLUSH_DELAY_MS = 10_000;
const MAX_INT = 2147483647;

/** What the batch's events point at, in its current state. */
interface Context {
  projects: Map<string, { name: string; slug: string; archived: boolean }>;
  names: Map<string, string>;
  systems: Map<string, { slug: string; title: string; boardId: string; columnName: string; category: string; archived: boolean }>;
  tasks: Map<number, { title: string }>;
  questions: Map<string, { title: string; priority: string }>;
  adrs: Map<string, { number: number; title: string; systemIds: string[] }>;
}

/** A post for one event before webhook matching: the Discord event, its text, an app-relative path and the systems it concerns. */
interface Draft {
  event: DiscordEvent;
  title: string;
  detail?: string;
  path: string;
  systemIds: string[];
}

/** Returns the posts an event can make, most specific first; a webhook gets the first it subscribes to. */
type Rule = (event: ChangeEvent, ctx: Context, base: string) => Draft[];

/** Parses a task id from a change-log entity id, or returns `null`. */
function taskId(event: ChangeEvent): number | null {
  const id = Number(event.entityId);
  return Number.isInteger(id) && id > 0 && id <= MAX_INT ? id : null;
}

const RULES: Record<string, Rule> = {
  "system/column": (event, ctx, base) => {
    const sys = ctx.systems.get(event.entityId);
    if (!sys || event.newValue === null) return [];
    const path = `${base}/systems/${sys.slug}`;
    const drafts: Draft[] = [];
    // Done and blocked only while the system is still in the column the event moved it to.
    if ((sys.category === "done" || sys.category === "blocked") && inMovedColumn(event.newValue, sys.columnName)) {
      drafts.push({ event: sys.category === "done" ? "system.done" : "system.blocked", title: `${sys.title} is ${sys.category}`, path, systemIds: [event.entityId] });
    }
    drafts.push({ event: "system.moved", title: `${sys.title} moved to ${event.newValue}`, detail: event.oldValue ? `From ${event.oldValue}` : undefined, path, systemIds: [event.entityId] });
    return drafts;
  },
  "planning/completed": (event, ctx, base) => {
    const sys = event.systemId ? ctx.systems.get(event.systemId) : undefined;
    if (!sys || !event.systemId) return [];
    return [{ event: "planning.completed", title: `Planning completed for ${sys.title}`, detail: event.newValue ?? undefined, path: `${base}/systems/${sys.slug}?tab=planning`, systemIds: [event.systemId] }];
  },
  "adr/created": (event, ctx, base) => {
    const a = ctx.adrs.get(event.entityId);
    if (!a) return [];
    return [{ event: "adr.proposed", title: `ADR-${formatAdrNumber(a.number)} proposed: ${a.title}`, path: `${base}/adrs/${a.number}`, systemIds: a.systemIds }];
  },
  "adr/status": (event, ctx, base) => {
    const a = ctx.adrs.get(event.entityId);
    if (!a || event.newValue !== "accepted") return [];
    return [{ event: "adr.accepted", title: `ADR-${formatAdrNumber(a.number)} accepted: ${a.title}`, path: `${base}/adrs/${a.number}`, systemIds: a.systemIds }];
  },
  "question/created": (event, ctx, base) => {
    const q = ctx.questions.get(event.entityId);
    if (!q) return [];
    const sys = event.systemId ? ctx.systems.get(event.systemId) : undefined;
    const title = `${q.priority === "blocking" ? "Blocking question" : "New question"}${sys ? ` on ${sys.title}` : ""}`;
    return [{ event: "question.asked", title, detail: q.title, path: `${base}/questions#q-${event.entityId}`, systemIds: sys && event.systemId ? [event.systemId] : [] }];
  },
  "question/answer": (event, ctx, base) => {
    const q = ctx.questions.get(event.entityId);
    if (!q || event.newValue === null) return [];
    const systemIds = event.systemId && ctx.systems.has(event.systemId) ? [event.systemId] : [];
    return [{ event: "question.answered", title: `Answered: ${q.title}`, detail: event.newValue, path: `${base}/questions#q-${event.entityId}`, systemIds }];
  },
  "update/posted": (event, ctx, base) => {
    const sys = event.systemId ? ctx.systems.get(event.systemId) : undefined;
    if (!sys || !event.systemId) return [];
    return [{ event: "update.posted", title: `Update on ${sys.title}`, detail: event.newValue ?? undefined, path: `${base}/systems/${sys.slug}`, systemIds: [event.systemId] }];
  },
  task: (event, ctx, base) => {
    const id = taskId(event);
    const sys = event.systemId ? ctx.systems.get(event.systemId) : undefined;
    if (id === null || !sys || !event.systemId) return [];
    const t = ctx.tasks.get(id);
    const detail = event.field === "created" ? `Added to ${sys.title}` : `${sys.title} · ${event.field}: ${event.oldValue ?? "none"} → ${event.newValue ?? "none"}`;
    return [{ event: "task.changed", title: `Task #${id}${t ? `: ${t.title}` : ""}`, detail, path: `${base}/systems/${sys.slug}#task-${id}`, systemIds: [event.systemId] }];
  },
};

/** The rule for an event; every task change shares one. */
function ruleOf(event: ChangeEvent): Rule | undefined {
  return event.entity === "task" ? RULES.task : RULES[`${event.entity}/${event.field}`];
}

/** Loads the current state of everything the events point at, with one query per table. */
async function loadContext(events: ChangeEvent[], deps: WorkerDeps): Promise<Context> {
  const { db } = deps;
  const of = (entity: string) => [...new Set(events.filter((e) => e.entity === entity).map((e) => e.entityId))];
  const taskIds = [...new Set(events.filter((e) => e.entity === "task").map(taskId))].filter((id): id is number => id !== null);
  const questionIds = of("question");
  const adrIds = of("adr");
  const authorIds = [...new Set(events.map((e) => e.authorUserId).filter((id): id is string => id !== null))];

  const [taskRows, questionRows, adrRows, authorRows, projectRows] = await Promise.all([
    taskIds.length ? db.select({ id: task.id, title: task.title }).from(task).where(inArray(task.id, taskIds)) : [],
    questionIds.length ? db.select({ id: question.id, title: question.title, priority: question.priority }).from(question).where(inArray(question.id, questionIds)) : [],
    adrIds.length
      ? db
          .select({ id: adr.id, number: adr.number, title: adr.title, systemId: adrSystem.systemId })
          .from(adr)
          .leftJoin(adrSystem, eq(adrSystem.adrId, adr.id))
          .where(inArray(adr.id, adrIds))
      : [],
    authorIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, authorIds)) : [],
    db
      .select({ id: project.id, name: project.name, slug: project.slug, archivedAt: project.archivedAt })
      .from(project)
      .where(inArray(project.id, [...new Set(events.map((e) => e.projectId))])),
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
  for (const a of adrs.values()) for (const id of a.systemIds) systemIds.add(id);
  const systemRows = systemIds.size
    ? await db
        .select({
          id: system.id,
          slug: system.slug,
          title: system.title,
          boardId: system.boardId,
          columnName: boardColumn.name,
          category: boardColumn.category,
          archivedAt: system.archivedAt,
        })
        .from(system)
        .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
        .where(inArray(system.id, [...systemIds]))
    : [];

  return {
    projects: new Map(projectRows.map((r) => [r.id, { name: r.name, slug: r.slug, archived: r.archivedAt !== null }])),
    names: new Map(authorRows.map((r) => [r.id, r.name])),
    systems: new Map(systemRows.map(({ id, archivedAt, ...rest }) => [id, { ...rest, archived: archivedAt !== null }])),
    tasks: new Map(taskRows.map(({ id, ...rest }) => [id, rest])),
    questions: new Map(questionRows.map(({ id, ...rest }) => [id, rest])),
    adrs,
  };
}

/**
 * Queues change-log entries in `discord_outbox` for each enabled webhook of the project that subscribes to them and
 * covers the boards of their systems, then schedules a flush of each webhook that got new rows. Entries without a
 * system reach only webhooks on all boards. Idempotent: each entry is queued once per webhook.
 */
export async function handleDiscordEvents(events: ChangeEvent[], deps: WorkerDeps): Promise<void> {
  const relevant = events.filter((e) => ruleOf(e));
  if (relevant.length === 0) return;
  const { db } = deps;
  const projectIds = [...new Set(relevant.map((e) => e.projectId))];
  const webhooks = await db
    .select({ id: projectWebhook.id, projectId: projectWebhook.projectId, events: projectWebhook.events, boardIds: projectWebhook.boardIds })
    .from(projectWebhook)
    .where(and(inArray(projectWebhook.projectId, projectIds), eq(projectWebhook.enabled, true)));
  if (webhooks.length === 0) return;

  const ctx = await loadContext(relevant, deps);
  const site = siteUrl();
  const rows: (typeof discordOutbox.$inferInsert)[] = [];
  for (const event of relevant) {
    const proj = ctx.projects.get(event.projectId);
    if (!proj || proj.archived) continue;
    const drafts = ruleOf(event)!(event, ctx, `/p/${proj.slug}`).filter((d) => d.systemIds.length === 0 || d.systemIds.some((id) => !ctx.systems.get(id)?.archived));
    if (drafts.length === 0) continue;
    const actorName = event.authorUserId || event.agent ? actorLabel(ctx.names.get(event.authorUserId ?? ""), event.agent) : null;
    for (const hook of webhooks.filter((w) => w.projectId === event.projectId)) {
      const draft = drafts.find((d) => {
        if (!hook.events.includes(d.event)) return false;
        if (hook.boardIds.length === 0) return true;
        // Boards deleted since the webhook was saved simply never match.
        return d.systemIds.some((id) => {
          const boardId = ctx.systems.get(id)?.boardId;
          return boardId !== undefined && hook.boardIds.includes(boardId);
        });
      });
      if (!draft) continue;
      const systemSlug = draft.systemIds.length === 1 ? ctx.systems.get(draft.systemIds[0])?.slug : undefined;
      const payload: DiscordItem = {
        event: draft.event,
        projectName: proj.name,
        projectSlug: proj.slug,
        ...(systemSlug ? { systemSlug } : {}),
        title: draft.title,
        detail: draft.detail ?? "",
        href: new URL(draft.path, site).href,
        actorName,
        at: event.createdAt.toISOString(),
      };
      rows.push({ webhookId: hook.id, changeLogId: event.id, payload });
    }
  }
  if (rows.length === 0) return;

  const inserted = await db.insert(discordOutbox).values(rows).onConflictDoNothing().returning({ webhookId: discordOutbox.webhookId });
  const bucket = Math.floor(deps.now().getTime() / 10_000);
  for (const webhookId of new Set(inserted.map((r) => r.webhookId))) {
    await deps.queue("deliver").add("discord.flush", { webhookId }, { jobId: `discord-flush-${webhookId}-${bucket}`, delayMs: FLUSH_DELAY_MS });
  }
}

registerFeedConsumer("discord", handleDiscordEvents);
