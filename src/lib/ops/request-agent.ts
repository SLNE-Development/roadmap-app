import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { eventChecklistItem, eventFallback, eventPost, eventRequest, eventSettings, project, system, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { DiffHunk } from "@/lib/diff";
import { MAX_POST_TEXT } from "@/lib/event-messages";
import { VISIBLE_PLACEHOLDERS } from "@/lib/event-placeholders";
import { PLACEHOLDER_MEANINGS } from "@/lib/event-prompts";
import type { askRoundInput, QuestionType } from "@/lib/event-questions";
import { DEFAULT_STYLE_GUIDES } from "@/lib/event-templates";
import { newId } from "@/lib/id";
import type { JobQueue } from "@/lib/queue";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { loadPostSettings } from "./event-settings";
import { requestAccess } from "./request-access";
import { livePost, plan } from "./request-posts";
import { getSpecBasis, requestProgress, type RequestProgress, type SpecBasis } from "./request-link";
import { askRound, listRounds, openQuestionCount } from "./request-questions";
import { compareBriefs, endsAtOf, getBrief, lockRequest, logRequest, queueDiscordEventSync } from "./requests";

/** The message kinds an agent writes. */
const WRITTEN_KINDS = ["team", "announcement", "reminder"] as const;

/** Longest answer text `get_request` returns whole. */
const ANSWER_CHARS = 500;

/** What an agent reads of a request. */
export interface RequestForAgent {
  id: string;
  title: string;
  status: string;
  startsAt: Date | null;
  durationMinutes: number | null;
  /** The end of the event; null without a duration. */
  endsAt: Date | null;
  where: string;
  summary: string;
  /** The event-day checklist in order. */
  checklist: { label: string; done: boolean }[];
  eventDocsUrl: string | null;
  requester: { name: string };
  project: { slug: string } | null;
  system: { slug: string } | null;
  brief: { version: number; body: string } | { version: number; since: number; diff: { hunks: DiffHunk[]; added: number; removed: number } };
  specBasis: SpecBasis | null;
  rounds: { number: number; questions: { id: string; type: QuestionType; text: string; answer: unknown; notSure: boolean; answered: boolean }[] }[];
  openQuestions: number;
  notSure: { questionId: string; text: string }[];
  fallback: { key: string; title: string; filled: boolean }[];
  progress: RequestProgress | null;
  /** What an agent needs to write the event's messages: placeholders, styles, examples and the live posts. */
  writing: {
    placeholders: { name: string; meaning: string }[];
    styles: { announcement: string; team: string; summary: string };
    examples: { announcement: string; reminder: string; team: string };
    rulebookUrl: string | null;
    messages: { kind: "team" | "announcement" | "reminder"; status: string; text: string; pingRole: boolean }[];
  };
  /** True when a long answer was cut. */
  truncated?: true;
}

/**
 * Checks that the actor acts as a developer of a submitted request; the agent runs as its developer user, so a requester's own agent cannot get through.
 *
 * @throws NotFoundError when the request is unknown, invisible or still a draft
 * @throws ForbiddenError when the actor may view but not develop the request
 */
async function agentAccess(db: Db, actor: Actor, requestId: string) {
  const access = await requestAccess(db, actor, requestId, "develop");
  if (access.request.status === "draft") throw new NotFoundError(`Unknown request ${requestId}.`);
  return access;
}

/** Asks a round of typed questions on behalf of the developer; see {@link askRound}. */
export async function askRequester(db: Db, actor: Actor, requestId: string, input: z.input<typeof askRoundInput>) {
  await agentAccess(db, actor, requestId);
  return askRound(db, actor, requestId, input);
}

/** Cuts every string longer than {@link ANSWER_CHARS} inside an answer and counts the cuts. */
function cutAnswer(value: unknown, cuts: { n: number }): unknown {
  if (typeof value === "string" && value.length > ANSWER_CHARS) {
    cuts.n += 1;
    return `${value.slice(0, ANSWER_CHARS)}… (${value.length - ANSWER_CHARS} more characters)`;
  }
  if (Array.isArray(value)) return value.map((v) => cutAnswer(v, cuts));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cutAnswer(v, cuts)]));
  return value;
}

/**
 * Returns a request for an agent: brief (or its diff since `sinceBrief`), event data, typed answers and open questions.
 * The fallback lists every scenario with whether it is filled in.
 *
 * @throws InvalidError unless `sinceBrief` is lower than the current brief version
 * @throws NotFoundError when the request is unknown, invisible or a draft
 * @throws ForbiddenError when the actor may not develop the request
 */
export async function requestForAgent(db: Db, actor: Actor, requestId: string, sinceBrief?: number): Promise<RequestForAgent> {
  const { request } = await agentAccess(db, actor, requestId);
  if (sinceBrief !== undefined && sinceBrief >= request.briefVersion) throw new InvalidError("sinceBrief must be lower than the current brief version.");
  const brief: RequestForAgent["brief"] =
    sinceBrief === undefined
      ? { version: request.briefVersion, body: (await getBrief(db, actor, requestId)).body }
      : { version: request.briefVersion, since: sinceBrief, diff: await compareBriefs(db, actor, requestId, sinceBrief, request.briefVersion) };
  const [[requester], [proj], [sys], rounds, openQuestions, specBasis, progress, fallbacks, checklist] = await Promise.all([
    db.select({ name: user.name }).from(user).where(eq(user.id, request.requesterId ?? "")).limit(1),
    request.projectId ? db.select({ slug: project.slug }).from(project).where(eq(project.id, request.projectId)).limit(1) : [],
    request.systemId ? db.select({ slug: system.slug }).from(system).where(eq(system.id, request.systemId)).limit(1) : [],
    listRounds(db, actor, requestId),
    openQuestionCount(db, requestId),
    getSpecBasis(db, requestId),
    requestProgress(db, actor, requestId),
    db.select().from(eventFallback).where(eq(eventFallback.requestId, requestId)).orderBy(asc(eventFallback.sortOrder)),
    db.select().from(eventChecklistItem).where(eq(eventChecklistItem.requestId, requestId)).orderBy(asc(eventChecklistItem.sortOrder)),
  ]);
  const [settings] = await db
    .select({
      rulebookUrl: eventSettings.rulebookUrl,
      announcementStyle: eventSettings.announcementStyle,
      teamStyle: eventSettings.teamStyle,
      summaryStyle: eventSettings.summaryStyle,
      announcementExample: eventSettings.announcementExample,
      reminderExample: eventSettings.reminderExample,
      teamExample: eventSettings.teamExample,
    })
    .from(eventSettings)
    .where(eq(eventSettings.id, "default"))
    .limit(1);
  const styleOf = (stored: string | undefined, fallback: string) => (stored?.trim() ? stored : fallback);
  const live = await Promise.all(WRITTEN_KINDS.map((kind) => livePost(db, requestId, kind)));
  const cuts = { n: 0 };
  const views = rounds.map((r) => ({
    number: r.number,
    questions: r.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, answer: cutAnswer(q.answer, cuts), notSure: q.notSure, answered: q.answeredAt !== null })),
  }));
  return {
    id: request.id,
    title: request.title,
    status: request.status,
    startsAt: request.startsAt,
    durationMinutes: request.durationMinutes,
    endsAt: endsAtOf(request),
    where: request.where,
    summary: request.summary,
    checklist: checklist.map((c) => ({ label: c.label, done: c.doneAt !== null })),
    eventDocsUrl: request.eventDocsUrl,
    requester: { name: requester?.name?.trim() || "unknown" },
    project: proj ?? null,
    system: sys ?? null,
    brief,
    specBasis,
    rounds: views,
    openQuestions,
    notSure: views.flatMap((r) => r.questions.filter((q) => q.notSure).map((q) => ({ questionId: q.id, text: q.text }))),
    fallback: fallbacks.map((f) => ({ key: f.key, title: f.title, filled: f.whatWeDo.trim() !== "" && f.whoDecides.trim() !== "" })),
    progress,
    writing: {
      placeholders: VISIBLE_PLACEHOLDERS.map((name) => ({ name, meaning: PLACEHOLDER_MEANINGS[name] })),
      styles: {
        announcement: styleOf(settings?.announcementStyle, DEFAULT_STYLE_GUIDES.announcement),
        team: styleOf(settings?.teamStyle, DEFAULT_STYLE_GUIDES.team),
        summary: styleOf(settings?.summaryStyle, DEFAULT_STYLE_GUIDES.summary),
      },
      examples: { announcement: settings?.announcementExample ?? "", reminder: settings?.reminderExample ?? "", team: settings?.teamExample ?? "" },
      rulebookUrl: settings?.rulebookUrl ?? null,
      messages: live.flatMap((post, i) => (post ? [{ kind: WRITTEN_KINDS[i], status: post.status, text: post.text, pingRole: post.pingRole }] : [])),
    },
    ...(cuts.n > 0 ? { truncated: true as const } : {}),
  };
}

/** Input of {@link writeEventMessages}; every key is optional, at least one message is required. */
export const writeEventMessagesInput = z.object({
  team: z.string().max(MAX_POST_TEXT).optional(),
  announcement: z.string().max(MAX_POST_TEXT).optional(),
  reminder: z.string().max(MAX_POST_TEXT).optional(),
  summary: z.string().trim().max(500).optional(),
  pingRole: z.object({ announcement: z.boolean().optional(), reminder: z.boolean().optional() }).optional(),
});

/** Edit access, or develop access for the developers who build the event. */
async function editOrDevelop(tx: Executor, actor: Actor, requestId: string) {
  try {
    return await requestAccess(tx, actor, requestId, "edit");
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
    return requestAccess(tx, actor, requestId, "develop");
  }
}

/**
 * Writes the drafts of the team notice, the announcement and the reminder, and the short description, exactly as given
 * (placeholders stay as they are; the app fills them when it sends). Nothing is posted. A kind whose post is already
 * sending, partial or posted is skipped with a reason while the others still save. Every planned part is checked against
 * Discord's limits first; one that does not fit refuses the whole call. A changed short description queues the Discord
 * event update when a `queue` is given.
 *
 * @throws InvalidError without any message or for a part that does not fit Discord, ConflictError for a done, withdrawn or cancelled request
 * @throws NotFoundError / ForbiddenError as {@link requestAccess} with edit, else develop access
 */
export async function writeEventMessages(
  db: Db,
  actor: Actor,
  requestId: string,
  raw: unknown,
  queue?: JobQueue,
): Promise<{ saved: ("team" | "announcement" | "reminder" | "summary")[]; skipped: { kind: "team" | "announcement" | "reminder"; reason: string }[] }> {
  const parsed = writeEventMessagesInput.safeParse(raw);
  if (!parsed.success) throw new InvalidError(parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;
  if (WRITTEN_KINDS.every((k) => input[k] === undefined) && input.summary === undefined) throw new InvalidError("Give at least one message.");
  let changedSummary: { id: string; discordEventId: string | null; updatedAt: Date } | null = null;
  const result = await db.transaction(async (tx) => {
    await editOrDevelop(tx, actor, requestId);
    const request = await lockRequest(tx, requestId);
    if (request.status === "done" || request.status === "withdrawn" || request.status === "cancelled") throw new ConflictError(`A ${request.status} request takes no new messages.`);
    const settings = await loadPostSettings(tx);
    const saved: ("team" | "announcement" | "reminder" | "summary")[] = [];
    const skipped: { kind: "team" | "announcement" | "reminder"; reason: string }[] = [];
    const writes: { kind: (typeof WRITTEN_KINDS)[number]; text: string; pingRole?: boolean; existingId: string | null }[] = [];
    for (const kind of WRITTEN_KINDS) {
      const text = input[kind];
      if (text === undefined) continue;
      const existing = await livePost(tx, requestId, kind);
      if (existing && (existing.status === "sending" || existing.status === "partial" || existing.status === "posted" || existing.parts.some((p) => p.messageId !== null))) {
        skipped.push({ kind, reason: "already posted; change it with Edit in the app" });
        continue;
      }
      const pingRole = kind === "team" ? undefined : input.pingRole?.[kind];
      try {
        plan({ kind, text, embed: existing?.embed ?? null, pingRole: pingRole ?? existing?.pingRole ?? false, note: existing?.note ?? null }, request, settings);
      } catch (e) {
        throw new InvalidError(`The ${kind} message does not fit Discord: ${e instanceof Error ? e.message : "too long"}`);
      }
      writes.push({ kind, text, pingRole, existingId: existing?.id ?? null });
    }
    for (const w of writes) {
      const changes = { text: w.text, ...(w.pingRole === undefined ? {} : { pingRole: w.pingRole }), updatedAt: new Date() };
      if (w.existingId) await tx.update(eventPost).set(changes).where(eq(eventPost.id, w.existingId));
      else await tx.insert(eventPost).values({ id: newId(), requestId, kind: w.kind, createdBy: actor.userId, ...changes });
      await logRequest(tx, actor, { requestId, field: "post", newValue: `${w.kind} draft written` });
      saved.push(w.kind);
    }
    if (input.summary !== undefined) {
      if (input.summary !== request.summary) {
        const [updated] = await tx.update(eventRequest).set({ summary: input.summary, updatedAt: new Date() }).where(eq(eventRequest.id, requestId)).returning();
        await logRequest(tx, actor, { requestId, field: "summary", oldValue: request.summary, newValue: input.summary });
        changedSummary = updated;
      }
      saved.push("summary");
    }
    return { saved, skipped };
  });
  if (changedSummary) await queueDiscordEventSync(db, queue, changedSummary, "update");
  return result;
}
