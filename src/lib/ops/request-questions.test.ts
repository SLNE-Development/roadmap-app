import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { eventRequest, notification, requestLog } from "@/db/schema";
import type { askedQuestionInput, QuestionType } from "@/lib/event-questions";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { answerQuestions, askRound, listRounds, openQuestionCount } from "./request-questions";
import { listRequests } from "./requests";

/** A question of each type, in the order of {@link QuestionType}. */
const MIXED: z.input<typeof askedQuestionInput>[] = [
  { type: "text", text: "What is the theme?", why: "It sets the decoration." },
  { type: "choice", text: "Which arena?", options: ["north", "south"], other: true, suggested: { option: "north" } },
  { type: "multi", text: "Which prizes?", options: ["a", "b", "c"], min: 1, max: 2 },
  { type: "number", text: "How many players?", min: 2, max: 40, unit: "players" },
  { type: "date", text: "Rehearsal day?" },
  { type: "time", text: "Rehearsal time?" },
  { type: "yesno", text: "Is there a voice chat?" },
  { type: "scale", text: "How hard?", max: 10 },
];

const VALUES: Record<QuestionType, unknown> = {
  text: "Winter",
  choice: { option: "south" },
  multi: { options: ["a", "c"] },
  number: 12,
  date: "2026-12-20",
  time: "18:30",
  yesno: true,
  scale: 7,
};

/** A database with a requester, a developer, a manager, a stranger and a submitted request. */
async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const U = await insertUser(db, { name: "Stranger" });
  const request = await requestFixture(db, R, { status: "submitted", title: "Winter party" });
  const rows = (kind: "request.question" | "request.answered") => db.select().from(notification).where(eq(notification.kind, kind));
  const first = (n = 5) => askRound(db, D, request.id, { questions: MIXED.slice(0, n) });
  return { db, R, D, M, U, request, rows, first };
}

describe("askRound", () => {
  it("numbers rounds per request and creates every question", async () => {
    const w = await world();
    const one = await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(0, 5) });
    expect(one.number).toBe(1);
    expect(one.questionIds).toHaveLength(5);
    // A second round is allowed while the first is fully unanswered.
    const two = await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(5) });
    expect(two.number).toBe(2);
    const rounds = await listRounds(w.db, w.R, w.request.id);
    expect(rounds.map((r) => r.number)).toEqual([1, 2]);
    expect(rounds[0].questions.map((q) => q.type)).toEqual(MIXED.slice(0, 5).map((q) => q.type));
    expect(rounds[0].questions[0]).toMatchObject({ why: "It sets the decoration.", required: true, answer: null, notSure: false });
    expect(rounds[0].questions[1]).toMatchObject({ options: ["north", "south"], other: true, suggested: { option: "north" } });
    expect(rounds[1].questions[2]).toMatchObject({ type: "scale", max: 10 });
  });

  it("refuses more than five questions and invalid ones", async () => {
    const w = await world();
    await expect(askRound(w.db, w.D, w.request.id, { questions: [...MIXED.slice(0, 5), MIXED[5]] })).rejects.toBeInstanceOf(InvalidError);
    await expect(askRound(w.db, w.D, w.request.id, { questions: [{ type: "choice", text: "x", options: ["only"] }] })).rejects.toBeInstanceOf(InvalidError);
    await expect(askRound(w.db, w.D, w.request.id, { questions: [] })).rejects.toBeInstanceOf(InvalidError);
  });

  it("is for developers: a requester is forbidden, a stranger does not see the request", async () => {
    const w = await world();
    await expect(askRound(w.db, w.R, w.request.id, { questions: MIXED.slice(0, 1) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(askRound(w.db, w.M, w.request.id, { questions: MIXED.slice(0, 1) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(askRound(w.db, w.U, w.request.id, { questions: MIXED.slice(0, 1) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs a submitted, accepted or event-week request", async () => {
    const w = await world();
    const draft = await requestFixture(w.db, w.R, { status: "draft" });
    await expect(askRound(w.db, w.D, draft.id, { questions: MIXED.slice(0, 1) })).rejects.toBeInstanceOf(NotFoundError);
    const done = await requestFixture(w.db, w.R, { status: "done" });
    await expect(askRound(w.db, w.D, done.id, { questions: MIXED.slice(0, 1) })).rejects.toBeInstanceOf(ConflictError);
    await w.db.update(eventRequest).set({ status: "draft" }).where(eq(eventRequest.id, w.request.id));
    const admin = await insertUser(w.db, { isAdmin: true });
    await expect(askRound(w.db, admin, w.request.id, { questions: MIXED.slice(0, 1) })).rejects.toBeInstanceOf(ConflictError);
    for (const status of ["accepted", "event_week"] as const) {
      await w.db.update(eventRequest).set({ status }).where(eq(eventRequest.id, w.request.id));
      await expect(askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(0, 1) })).resolves.toBeDefined();
    }
  });

  it("notifies the requester once and not the asker, and logs the round", async () => {
    const w = await world();
    await w.first();
    const rows = await w.rows("request.question");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: w.R.userId, requestId: w.request.id, sourceKey: `req:${w.request.id}:round:1`, title: "The team has questions about Winter party" });
    const log = await w.db.select().from(requestLog).where(eq(requestLog.requestId, w.request.id));
    expect(log.filter((l) => l.field === "questions").map((l) => l.newValue)).toEqual(["round 1 asked"]);
  });
});


describe("answerQuestions", () => {
  it("stores one typed value per type and lists the same shapes back", async () => {
    const w = await world();
    const a = await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(0, 4) });
    const b = await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(4) });
    const ids = [...a.questionIds, ...b.questionIds];
    await answerQuestions(w.db, w.R, w.request.id, { answers: ids.map((id, i) => ({ questionId: id, value: VALUES[MIXED[i].type] })) });
    const rounds = await listRounds(w.db, w.D, w.request.id);
    const questions = rounds.flatMap((r) => r.questions);
    expect(questions.map((q) => q.answer)).toEqual(MIXED.map((q) => VALUES[q.type]));
    expect(questions.every((q) => !q.notSure && q.answeredByName === "Requester" && q.answeredAt instanceof Date)).toBe(true);
    expect(await openQuestionCount(w.db, w.request.id)).toBe(0);
  });

  it("names the question of a wrongly typed answer and stores nothing", async () => {
    const w = await world();
    const { questionIds } = await w.first(3);
    const answers = [
      { questionId: questionIds[0], value: "fine" },
      { questionId: questionIds[1], value: { option: "west" } },
    ];
    const error = await answerQuestions(w.db, w.R, w.request.id, { answers }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidError);
    expect(error.message).toContain("Which arena?");
    expect(await openQuestionCount(w.db, w.request.id)).toBe(3);
  });

  it("stores not sure without a value, and refuses both or neither", async () => {
    const w = await world();
    const {
      questionIds: [text, choice],
    } = await w.first(2);
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: text, notSure: true }] });
    const [round] = await listRounds(w.db, w.R, w.request.id);
    expect(round.questions[0]).toMatchObject({ answer: null, notSure: true, answeredByName: "Requester" });
    expect(round.questions[0].answeredAt).toBeInstanceOf(Date);
    expect(await openQuestionCount(w.db, w.request.id)).toBe(1);
    await expect(answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: choice, value: { option: "north" }, notSure: true }] })).rejects.toBeInstanceOf(InvalidError);
    await expect(answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: choice }] })).rejects.toBeInstanceOf(InvalidError);
    await expect(answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: choice, notSure: false }] })).rejects.toBeInstanceOf(InvalidError);
  });

  it("re-answering overwrites; a value replaces not sure and the other way round", async () => {
    const w = await world();
    const {
      questionIds: [text],
    } = await w.first(1);
    const read = async () => (await listRounds(w.db, w.R, w.request.id))[0].questions[0];
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: text, notSure: true }] });
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: text, value: "Winter" }] });
    expect(await read()).toMatchObject({ answer: "Winter", notSure: false });
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: text, notSure: true }] });
    expect(await read()).toMatchObject({ answer: null, notSure: true });
  });

  it("refuses an unknown question, one of another request and a repeated one", async () => {
    const w = await world();
    const other = await requestFixture(w.db, w.R, { status: "submitted" });
    const theirs = await askRound(w.db, w.D, other.id, { questions: MIXED.slice(0, 1) });
    const {
      questionIds: [mine],
    } = await w.first(1);
    const bad = await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: theirs.questionIds[0], value: "x" }] }).catch((e) => e);
    expect(bad).toBeInstanceOf(InvalidError);
    expect(bad.message).toContain(theirs.questionIds[0]);
    await expect(answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: "nope", value: "x" }] })).rejects.toBeInstanceOf(InvalidError);
    await expect(
      answerQuestions(w.db, w.R, w.request.id, {
        answers: [
          { questionId: mine, value: "x" },
          { questionId: mine, value: "y" },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidError);
  });

  it("lets the requester and managers answer, and nobody else", async () => {
    const w = await world();
    const {
      questionIds: [q],
    } = await w.first(1);
    await expect(answerQuestions(w.db, w.U, w.request.id, { answers: [{ questionId: q, value: "x" }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(answerQuestions(w.db, w.D, w.request.id, { answers: [{ questionId: q, value: "x" }] })).rejects.toBeInstanceOf(ForbiddenError);
    await answerQuestions(w.db, w.M, w.request.id, { answers: [{ questionId: q, value: "x" }] });
    expect((await listRounds(w.db, w.R, w.request.id))[0].questions[0].answeredByName).toBe("Manager");
  });

  it("notifies developers once when the last question of a round is answered, naming the not-sure ones", async () => {
    const w = await world();
    const { questionIds } = await w.first(3);
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: questionIds[0], value: "Winter" }] });
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: questionIds[1], notSure: true }] });
    expect(await w.rows("request.answered")).toHaveLength(0);
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: questionIds[2], value: { options: ["a"] } }] });
    const rows = await w.rows("request.answered");
    expect(rows.map((r) => r.userId)).toEqual([w.D.userId]);
    expect(rows[0]).toMatchObject({ sourceKey: `req:${w.request.id}:answered:1`, title: "Requester answered the questions on Winter party" });
    expect(rows[0].body).toContain("1");
    expect(rows[0].body.toLowerCase()).toContain("not sure");
    // Re-answering after completion does not notify again.
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: questionIds[0], value: "Summer" }] });
    expect(await w.rows("request.answered")).toHaveLength(1);
  });

  it("notifies per round and says so when nothing is not sure", async () => {
    const w = await world();
    const a = await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(0, 1) });
    const b = await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(4, 5) });
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: b.questionIds[0], value: "2026-12-20" }] });
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: a.questionIds[0], value: "Winter" }] });
    const rows = (await w.rows("request.answered")).sort((x, y) => x.sourceKey.localeCompare(y.sourceKey));
    expect(rows.map((r) => r.sourceKey)).toEqual([`req:${w.request.id}:answered:1`, `req:${w.request.id}:answered:2`]);
    expect(rows[0].body.toLowerCase()).not.toContain("not sure");
  });
});

describe("openQuestionCount and waitingOnRequester", () => {
  it("counts unanswered questions across rounds and flags the request in the list", async () => {
    const w = await world();
    expect(await openQuestionCount(w.db, w.request.id)).toBe(0);
    const find = async () => (await listRequests(w.db, w.R)).find((r) => r.id === w.request.id)!;
    expect((await find()).waitingOnRequester).toBe(false);
    const a = await w.first(2);
    await askRound(w.db, w.D, w.request.id, { questions: MIXED.slice(5, 6) });
    expect(await openQuestionCount(w.db, w.request.id)).toBe(3);
    expect((await find()).waitingOnRequester).toBe(true);
    await answerQuestions(w.db, w.R, w.request.id, {
      answers: [
        { questionId: a.questionIds[0], value: "x" },
        { questionId: a.questionIds[1], notSure: true },
      ],
    });
    expect(await openQuestionCount(w.db, w.request.id)).toBe(1);
  });
});
