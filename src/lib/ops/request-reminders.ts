import { and, eq, inArray, isNull, min, ne, or, gt } from "drizzle-orm";
import { eventPost, eventQuestion, eventQuestionRound, eventRequest, eventTodo, requestLog, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { POST_DUE_OFFSET_DAYS, POST_TODO_KEY, type PostKind } from "@/lib/event-messages";
import { dueFor } from "@/lib/event-prep-template";
import { workingDaysBetween } from "@/lib/event-work-days";
import { eventTimeZone } from "./event-settings";
import { developerIds, managerIds, notifyRequest } from "./request-notify";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The posts that have a due date and a reminder. */
const REMINDED_POSTS = ["team", "announcement", "reminder"] as const satisfies readonly PostKind[];

/** `at` as a `YYYY-MM-DD` date in `zone`. */
const localDate = (at: Date, zone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** What a run created. */
export interface ReminderResult {
  /** How many notices were created. */
  created: number;
}

/**
 * Creates the reminders that are due at `now` and returns how many notices it made. It only writes notifications through
 * `notifyRequest`, each deduplicated by its `sourceKey` (the to-do and message reminders carry their due date, so a re-dated
 * one reminds again), so a second run creates nothing new. It never posts, never
 * changes a status or a post and never calls Discord. `submitted` requests are considered for the pickup reminder; only
 * `accepted` and `event_week` requests for the others.
 */
export async function runRequestReminders(db: Db, now: Date): Promise<ReminderResult> {
  const zone = await eventTimeZone(db);
  const requests = await db
    .select({
      id: eventRequest.id,
      title: eventRequest.title,
      status: eventRequest.status,
      requesterId: eventRequest.requesterId,
      startsAt: eventRequest.startsAt,
      submittedAt: eventRequest.submittedAt,
    })
    .from(eventRequest)
    .where(inArray(eventRequest.status, ["submitted", "accepted", "event_week"]));
  const live = requests.filter((r) => r.status !== "submitted");
  const developers = await developerIds(db);
  const managers = await managerIds(db);
  let created = 0;

  // 1. Pickup: submitted for two working days and no developer or admin has touched it since.
  for (const r of requests) {
    if (r.status !== "submitted" || !r.submittedAt || workingDaysBetween(r.submittedAt, now, zone) < 2) continue;
    const [activity] = await db
      .select({ id: requestLog.id })
      .from(requestLog)
      .innerJoin(user, eq(user.id, requestLog.authorUserId))
      .where(
        and(
          eq(requestLog.requestId, r.id),
          gt(requestLog.createdAt, r.submittedAt),
          inArray(requestLog.field, ["questions", "status", "project"]),
          or(ne(requestLog.field, "status"), isNull(requestLog.newValue), ne(requestLog.newValue, "submitted")),
          or(eq(user.isAdmin, true), eq(user.isEventDeveloper, true)),
        ),
      )
      .limit(1);
    if (activity) continue;
    created += await notifyRequest(db, {
      requestId: r.id,
      kind: "request.pickup",
      userIds: developers,
      title: { key: "requestPickup", values: { title: r.title } },
      sourceKey: `req:${r.id}:pickup:${r.submittedAt.toISOString().slice(0, 10)}`,
      actor: null,
    });
  }

  const liveIds = live.map((r) => r.id);
  const byId = new Map(requests.map((r) => [r.id, r]));

  // 2. Waiting on the requester: per round, from its oldest unanswered question; questions are mostly asked while a request is submitted.
  const waitIds = requests.map((r) => r.id);
  if (waitIds.length === 0) return { created };
  const waiting = await db
    .select({ requestId: eventQuestion.requestId, number: eventQuestionRound.number, since: min(eventQuestion.createdAt) })
    .from(eventQuestion)
    .innerJoin(eventQuestionRound, eq(eventQuestionRound.id, eventQuestion.roundId))
    .where(and(inArray(eventQuestion.requestId, waitIds), isNull(eventQuestion.answeredAt)))
    .groupBy(eventQuestion.requestId, eventQuestionRound.id, eventQuestionRound.number);
  for (const w of waiting) {
    const r = byId.get(w.requestId)!;
    const age = w.since ? now.getTime() - w.since.getTime() : 0;
    if (age < DAY_MS || !r.requesterId) continue;
    const base = `req:${r.id}:wait:${w.number}`;
    const threeDays = age >= 3 * DAY_MS;
    created += await notifyRequest(db, {
      requestId: r.id,
      kind: "request.waiting",
      userIds: [r.requesterId],
      title: { key: "requestWaiting", values: { title: r.title } },
      sourceKey: `${base}:${threeDays ? "d3" : "d1"}`,
      tab: "questions",
      actor: null,
    });
    if (threeDays) {
      const [owner] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.requesterId));
      created += await notifyRequest(db, {
        requestId: r.id,
        kind: "request.waiting",
        userIds: managers,
        title: { key: "requestWaitingManagers", values: { title: r.title, name: owner?.name?.trim() || "?" } },
        sourceKey: `${base}:d3m`,
        tab: "questions",
        actor: null,
      });
    }
  }

  // 3. To-dos that are late or due within a day. The to-dos of the three messages are left to step 4, which names the message.
  const postKeys = Object.values(POST_TODO_KEY);
  const todos = liveIds.length === 0 ? [] : await db.select().from(eventTodo).where(and(inArray(eventTodo.requestId, liveIds), isNull(eventTodo.doneAt)));
  for (const todo of todos) {
    if (todo.templateKey && postKeys.includes(todo.templateKey)) continue;
    const r = byId.get(todo.requestId)!;
    const untilDue = todo.dueAt.getTime() - now.getTime();
    const sinceDue = -untilDue;
    const recipients = [todo.ownerUserId, r.requesterId].filter((id): id is string => id !== null);
    // The due date is part of the key: a to-do that is moved to a new date reminds again.
    const base = `req:${r.id}:todo:${todo.id}:${localDate(todo.dueAt, zone)}`;
    const send = async (key: "requestTodoLate" | "requestTodoSoon", suffix: string) => {
      created += await notifyRequest(db, {
        requestId: r.id,
        kind: "request.todo_due",
        userIds: recipients,
        title: { key, values: { todo: todo.title, title: r.title } },
        sourceKey: `${base}:${suffix}`,
        tab: "prep",
        actor: null,
      });
    };
    if (sinceDue >= 3 * DAY_MS) await send("requestTodoLate", "late3");
    else if (sinceDue >= 0) await send("requestTodoLate", "late");
    else if (untilDue <= DAY_MS) await send("requestTodoSoon", "soon");
  }

  // 4. Messages that are due and not posted: a notice only, never a post.
  const posted =
    liveIds.length === 0
      ? []
      : await db
          .select({ requestId: eventPost.requestId, kind: eventPost.kind })
          .from(eventPost)
          .where(and(inArray(eventPost.requestId, liveIds), eq(eventPost.status, "posted"), inArray(eventPost.kind, [...REMINDED_POSTS])));
  const isPosted = new Set(posted.map((p) => `${p.requestId}:${p.kind}`));
  const postTitle = { team: "requestPostTeam", announcement: "requestPostAnnouncement", reminder: "requestPostReminder" } as const;
  for (const r of live) {
    if (!r.startsAt) continue;
    for (const kind of REMINDED_POSTS) {
      if (isPosted.has(`${r.id}:${kind}`)) continue;
      const dueAt = dueFor(r.startsAt, POST_DUE_OFFSET_DAYS[kind]!, zone);
      const untilDue = dueAt.getTime() - now.getTime();
      if (untilDue > DAY_MS) continue;
      const overdue = untilDue < 0;
      created += await notifyRequest(db, {
        requestId: r.id,
        kind: "request.todo_due",
        userIds: [
          ...(r.requesterId ? [r.requesterId] : []),
          // The owner of the matching template to-do, who may be a developer or a manager.
          ...todos.filter((t) => t.requestId === r.id && t.templateKey === POST_TODO_KEY[kind] && t.ownerUserId).map((t) => t.ownerUserId!),
          ...(overdue ? managers : []),
        ],
        title: { key: postTitle[kind], values: { title: r.title, date: localDate(dueAt, zone) } },
        sourceKey: `req:${r.id}:post:${kind}:${localDate(dueAt, zone)}:${overdue ? "late" : "soon"}`,
        tab: "messages",
        actor: null,
      });
    }
  }
  return { created };
}
