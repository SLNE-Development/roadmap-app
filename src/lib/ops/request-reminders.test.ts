import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventPost, eventQuestion, eventQuestionRound, eventRequest, eventTodo, notification, requestLog } from "@/db/schema";
import { newId } from "@/lib/id";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { runRequestReminders } from "./request-reminders";
import { logRequest } from "./requests";
import { ensurePrepTodos } from "./request-setup";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A Wednesday, 13:00 in Berlin. */
const NOW = new Date("2026-01-14T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** An admin, a developer, a manager and a requester; nothing else exists yet. */
async function world() {
  const db = await createTestDb();
  const A = await insertUser(db, { name: "Admin", isAdmin: true });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const R = await insertUser(db, { name: "Requester" });
  const sources = async () =>
    (await db.select({ userId: notification.userId, kind: notification.kind, sourceKey: notification.sourceKey, title: notification.title, href: notification.href }).from(notification)).sort((a, b) =>
      (a.sourceKey + a.userId).localeCompare(b.sourceKey + b.userId),
    );
  const notices = async (kind: string) => (await sources()).filter((n) => n.kind === kind);
  const request = (over: Partial<typeof eventRequest.$inferInsert> = {}) => requestFixture(db, R, { startsAt: later(30 * DAY), ...over });
  return { db, A, D, M, R, sources, notices, request };
}
type World = Awaited<ReturnType<typeof world>>;

/** Adds a round with `n` open questions, asked `ageMs` before NOW; returns the question ids. */
async function openRound(db: World["db"], requestId: string, ageMs: number, number = 1, n = 2) {
  const roundId = newId();
  await db.insert(eventQuestionRound).values({ id: roundId, requestId, number, createdAt: ago(ageMs) });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId();
    ids.push(id);
    await db.insert(eventQuestion).values({ id, roundId, requestId, position: i, type: "text", text: `Q${i}`, config: {}, createdAt: ago(ageMs) });
  }
  return ids;
}

/** `at` as `YYYY-MM-DD` in the event time zone (Europe/Berlin), the date a reminder key carries. */
const berlinDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** The last `:`-separated part of a source key. */
const tail = (key: string) => key.split(":").pop();

describe("pickup reminder", () => {
  it("tells every admin and event developer once about a request that waited three working days", async () => {
    const w = await world();
    const r = await w.request({ status: "submitted", submittedAt: new Date("2026-01-09T12:00:00Z") });
    await runRequestReminders(w.db, NOW);
    const pickup = await w.notices("request.pickup");
    expect(pickup.map((n) => n.userId).sort()).toEqual([w.A.userId, w.D.userId].sort());
    expect(pickup[0].sourceKey).toBe(`req:${r.id}:pickup:2026-01-09`);
    expect(pickup[0].href).toBe(`/requests/${r.id}`);
    await runRequestReminders(w.db, later(HOUR));
    expect(await w.notices("request.pickup")).toHaveLength(2);
  });

  it("stops once a developer has asked a question since the submission", async () => {
    const w = await world();
    const r = await w.request({ status: "submitted", submittedAt: new Date("2026-01-09T12:00:00Z") });
    await logRequest(w.db, w.D, { requestId: r.id, field: "questions", newValue: "round 1 asked" });
    await w.db.update(requestLog).set({ createdAt: new Date("2026-01-12T10:00:00Z") }).where(eq(requestLog.requestId, r.id));
    await runRequestReminders(w.db, NOW);
    expect(await w.notices("request.pickup")).toHaveLength(0);
  });

  it("is not stopped by the requester's own submit or by activity before the submission", async () => {
    const w = await world();
    const r = await w.request({ status: "submitted", submittedAt: new Date("2026-01-09T12:00:00Z") });
    await logRequest(w.db, w.R, { requestId: r.id, field: "status", oldValue: "draft", newValue: "submitted" });
    await logRequest(w.db, w.D, { requestId: r.id, field: "status", oldValue: "submitted", newValue: "draft" });
    await w.db.update(requestLog).set({ createdAt: new Date("2026-01-05T10:00:00Z") }).where(and(eq(requestLog.requestId, r.id), eq(requestLog.authorUserId, w.D.userId)));
    await w.db.update(requestLog).set({ createdAt: new Date("2026-01-09T12:00:00Z") }).where(and(eq(requestLog.requestId, r.id), eq(requestLog.authorUserId, w.R.userId)));
    await runRequestReminders(w.db, NOW);
    expect(await w.notices("request.pickup")).toHaveLength(2);
  });

  it("waits for two working days: one day is too early and a weekend does not count", async () => {
    const w = await world();
    await w.request({ status: "submitted", submittedAt: ago(DAY) });
    await runRequestReminders(w.db, NOW);
    expect(await w.notices("request.pickup")).toHaveLength(0);
    // Submitted Friday midday, seen on Sunday: two calendar days but no working day.
    const weekend = await world();
    await weekend.request({ status: "submitted", submittedAt: new Date("2026-01-09T12:00:00Z") });
    await runRequestReminders(weekend.db, new Date("2026-01-11T12:00:00Z"));
    expect(await weekend.notices("request.pickup")).toHaveLength(0);
  });

  it("sends a new reminder after recall and resubmit", async () => {
    const w = await world();
    const r = await w.request({ status: "submitted", submittedAt: new Date("2026-01-09T12:00:00Z") });
    await runRequestReminders(w.db, NOW);
    await w.db.update(eventRequest).set({ submittedAt: new Date("2026-01-12T12:00:00Z") }).where(eq(eventRequest.id, r.id));
    await runRequestReminders(w.db, new Date("2026-01-15T12:00:00Z"));
    const keys = new Set((await w.notices("request.pickup")).map((n) => n.sourceKey));
    expect([...keys].sort()).toEqual([`req:${r.id}:pickup:2026-01-09`, `req:${r.id}:pickup:2026-01-12`]);
  });
});

describe("waiting on the requester", () => {
  it("reminds only the requester after a day, with the event name in the title", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted", title: "Lantern night" });
    await openRound(w.db, r.id, 25 * HOUR);
    await runRequestReminders(w.db, NOW);
    const waiting = await w.notices("request.waiting");
    expect(waiting.map((n) => [n.userId, n.sourceKey])).toEqual([[w.R.userId, `req:${r.id}:wait:1:d1`]]);
    expect(waiting[0].title).toContain("Lantern night");
    expect(waiting[0].href).toBe(`/requests/${r.id}?tab=questions`);
  });

  it("also reminds about a submitted request", async () => {
    const w = await world();
    const r = await w.request({ status: "submitted", submittedAt: ago(HOUR) });
    await openRound(w.db, r.id, 25 * HOUR);
    await runRequestReminders(w.db, NOW);
    expect((await w.notices("request.waiting")).map((n) => [n.userId, n.sourceKey])).toEqual([[w.R.userId, `req:${r.id}:wait:1:d1`]]);
  });

  it("sends nothing before a day", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await openRound(w.db, r.id, 23 * HOUR);
    await runRequestReminders(w.db, NOW);
    expect(await w.sources()).toHaveLength(0);
  });

  it("escalates after three days to the requester and once to the managers, without repeating the day-one key", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await openRound(w.db, r.id, 25 * HOUR);
    await runRequestReminders(w.db, NOW);
    await runRequestReminders(w.db, later(48 * HOUR));
    await runRequestReminders(w.db, later(49 * HOUR));
    const waiting = await w.notices("request.waiting");
    expect(waiting.filter((n) => tail(n.sourceKey) === "d1").map((n) => n.userId)).toEqual([w.R.userId]);
    expect(waiting.filter((n) => tail(n.sourceKey) === "d3").map((n) => n.userId)).toEqual([w.R.userId]);
    expect(waiting.filter((n) => tail(n.sourceKey) === "d3m").map((n) => n.userId).sort()).toEqual([w.A.userId, w.M.userId].sort());
  });

  it("at 73 hours sends the three-day notices", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await openRound(w.db, r.id, 73 * HOUR);
    await runRequestReminders(w.db, NOW);
    expect((await w.notices("request.waiting")).map((n) => tail(n.sourceKey)).sort()).toEqual(["d3", "d3m", "d3m"]);
  });

  it("counts rounds separately", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await openRound(w.db, r.id, 26 * HOUR, 1, 1);
    await openRound(w.db, r.id, 30 * HOUR, 2, 1);
    await runRequestReminders(w.db, NOW);
    expect((await w.notices("request.waiting")).map((n) => n.sourceKey).sort()).toEqual([`req:${r.id}:wait:1:d1`, `req:${r.id}:wait:2:d1`]);
  });

  it("stops when everything is answered, a not-sure answer included", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await openRound(w.db, r.id, 80 * HOUR);
    await w.db.update(eventQuestion).set({ answeredAt: NOW, notSure: true }).where(eq(eventQuestion.requestId, r.id));
    await runRequestReminders(w.db, NOW);
    expect(await w.sources()).toHaveLength(0);
  });

  it("measures from the oldest unanswered question of the round", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    const [first] = await openRound(w.db, r.id, 80 * HOUR, 1, 2);
    await w.db.update(eventQuestion).set({ answeredAt: ago(2 * HOUR) }).where(eq(eventQuestion.id, first));
    await w.db.update(eventQuestion).set({ createdAt: ago(10 * HOUR) }).where(and(eq(eventQuestion.requestId, r.id), eq(eventQuestion.position, 1)));
    await runRequestReminders(w.db, NOW);
    expect(await w.sources()).toHaveLength(0);
  });
});

describe("late and soon to-dos", () => {
  const todo = async (db: World["db"], requestId: string, ownerUserId: string | null, dueAt: Date, extra: Partial<typeof eventTodo.$inferInsert> = {}) =>
    (await db.insert(eventTodo).values({ id: newId(), requestId, title: "Book the stage", ownerUserId, dueAt, ...extra }).returning())[0];

  it("notifies the owner and the requester once when a to-do turns late, and again three days later", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    const t = await todo(w.db, r.id, w.D.userId, ago(2 * HOUR));
    await runRequestReminders(w.db, NOW);
    await runRequestReminders(w.db, later(HOUR));
    const late = await w.notices("request.todo_due");
    expect(late.map((n) => [n.userId, n.sourceKey]).sort()).toEqual(
      [
        [w.D.userId, `req:${r.id}:todo:${t.id}:${berlinDay(t.dueAt)}:late`],
        [w.R.userId, `req:${r.id}:todo:${t.id}:${berlinDay(t.dueAt)}:late`],
      ].sort(),
    );
    expect(late[0].title).toContain("Book the stage");
    expect(late[0].href).toBe(`/requests/${r.id}?tab=prep`);
    await runRequestReminders(w.db, new Date(t.dueAt.getTime() + 3 * DAY + HOUR));
    expect((await w.notices("request.todo_due")).map((n) => tail(n.sourceKey)).sort()).toEqual(["late", "late", "late3", "late3"]);
  });

  it("notifies only the requester when the owner is the requester or gone", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await todo(w.db, r.id, w.R.userId, ago(HOUR));
    await todo(w.db, r.id, null, ago(HOUR));
    await runRequestReminders(w.db, NOW);
    const notices = await w.notices("request.todo_due");
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((n) => n.userId === w.R.userId)).toBe(true);
  });

  it("gives a to-do due within 24 hours one heads-up", async () => {
    const w = await world();
    const r = await w.request({ status: "event_week" });
    const t = await todo(w.db, r.id, w.D.userId, later(12 * HOUR));
    await todo(w.db, r.id, w.D.userId, later(36 * HOUR));
    await runRequestReminders(w.db, NOW);
    await runRequestReminders(w.db, later(HOUR));
    expect((await w.notices("request.todo_due")).map((n) => n.sourceKey)).toEqual([`req:${r.id}:todo:${t.id}:${berlinDay(t.dueAt)}:soon`, `req:${r.id}:todo:${t.id}:${berlinDay(t.dueAt)}:soon`]);
  });

  it("reminds again after the to-do is moved to a new due date", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    const t = await todo(w.db, r.id, w.D.userId, ago(2 * HOUR));
    await runRequestReminders(w.db, NOW);
    const first = (await w.notices("request.todo_due")).length;
    expect(first).toBeGreaterThan(0);
    await w.db.update(eventTodo).set({ dueAt: ago(2 * HOUR + 5 * DAY) }).where(eq(eventTodo.id, t.id));
    await runRequestReminders(w.db, NOW);
    const keys = new Set((await w.notices("request.todo_due")).map((n) => n.sourceKey));
    expect(keys.size).toBeGreaterThan(1);
    expect(await w.notices("request.todo_due")).toHaveLength(first * 2);
  });

  it("ignores done to-dos and requests that are not accepted or in event week", async () => {
    const w = await world();
    const r = await w.request({ status: "accepted" });
    await todo(w.db, r.id, w.D.userId, ago(DAY), { doneAt: ago(HOUR) });
    for (const status of ["withdrawn", "cancelled", "done", "draft"] as const) {
      const other = await w.request({ status });
      await todo(w.db, other.id, w.D.userId, ago(DAY));
      await openRound(w.db, other.id, 80 * HOUR);
    }
    await runRequestReminders(w.db, NOW);
    expect(await w.sources()).toHaveLength(0);
  });
});

describe("a post that is due", () => {
  /** An accepted request starting `daysAhead` days after NOW, with its template to-dos. */
  async function dueWorld(daysAhead: number) {
    const w = await world();
    const r = await w.request({ status: "accepted", title: "Lantern night", startsAt: later(daysAhead * DAY) });
    await ensurePrepTodos(w.db, r, w.D.userId);
    const posts = async () => (await w.notices("request.todo_due")).filter((n) => n.sourceKey.includes(":post:"));
    return { ...w, r, posts };
  }

  it("tells the requester and the managers about an overdue announcement and links to Messages", async () => {
    const w = await dueWorld(6);
    await runRequestReminders(w.db, NOW);
    const late = (await w.posts()).filter((n) => /:announcement:\d{4}-\d{2}-\d{2}:late$/.test(n.sourceKey));
    expect(late.map((n) => n.userId).sort()).toEqual([w.R.userId, w.A.userId, w.M.userId].sort());
    expect(late[0].title).toMatch(/^Post the announcement for Lantern night \(due /);
    expect(late[0].href).toBe(`/requests/${w.r.id}?tab=messages`);
  });

  it("also tells the owner of the matching template to-do, once", async () => {
    const w = await dueWorld(6);
    await w.db.update(eventTodo).set({ ownerUserId: w.D.userId }).where(and(eq(eventTodo.requestId, w.r.id), eq(eventTodo.templateKey, "announcement")));
    await runRequestReminders(w.db, NOW);
    await runRequestReminders(w.db, later(HOUR));
    const late = (await w.posts()).filter((n) => /:announcement:\d{4}-\d{2}-\d{2}:late$/.test(n.sourceKey));
    expect(late.map((n) => n.userId).sort()).toEqual([w.R.userId, w.D.userId, w.A.userId, w.M.userId].sort());
  });

  it("gives the requester a heads-up within 24 hours before the due date", async () => {
    // The announcement is due 7 days before the event at 09:00 Berlin: here about 22 hours after NOW.
    const w = await dueWorld(8);
    await runRequestReminders(w.db, NOW);
    expect((await w.posts()).filter((n) => n.sourceKey.includes(":announcement:")).map((n) => [n.userId, n.sourceKey])).toEqual([[w.R.userId, expect.stringMatching(new RegExp(`^req:${w.r.id}:post:announcement:\\d{4}-\\d{2}-\\d{2}:soon$`))]]);
  });

  it("reminds again about a message after the event moved", async () => {
    const w = await dueWorld(6);
    await runRequestReminders(w.db, NOW);
    const before = (await w.posts()).length;
    await w.db.update(eventRequest).set({ startsAt: later(5 * DAY) }).where(eq(eventRequest.id, w.r.id));
    await runRequestReminders(w.db, NOW);
    expect((await w.posts()).length).toBeGreaterThan(before);
  });

  it("does not notify before the 24-hour window or once the post is posted", async () => {
    const far = await dueWorld(20);
    await runRequestReminders(far.db, NOW);
    expect(await far.posts()).toHaveLength(0);
    const w = await dueWorld(6);
    await w.db.insert(eventPost).values({ id: newId(), requestId: w.r.id, kind: "announcement", status: "posted", text: "x" });
    await runRequestReminders(w.db, NOW);
    expect((await w.posts()).filter((n) => n.sourceKey.includes(":announcement:"))).toHaveLength(0);
  });

  it("does not repeat the notice through the template to-do of the same message", async () => {
    const w = await dueWorld(6);
    await runRequestReminders(w.db, NOW);
    expect((await w.notices("request.todo_due")).filter((n) => n.sourceKey.includes(":todo:"))).toHaveLength(0);
  });
});
