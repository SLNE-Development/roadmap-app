import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { changeLog, notification } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { withAgent } from "./actor";
import { ForbiddenError } from "./errors";
import { addQuestion, answerQuestion, listQuestions, setQuestionPriority, setQuestionResolved } from "./questions";
import { createSystem } from "./systems";

describe("questions", () => {
  it("adds, answers and lists questions with unresolved first", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const a = await addQuestion(db, owner, slug, { title: "A?", system: "s" });
    await addQuestion(db, owner, slug, { title: "B?" });
    await answerQuestion(db, owner, slug, { id: a.id, answer: "Yes" });
    const all = await listQuestions(db, owner, slug);
    expect(all.map((q) => [q.title, q.resolved, q.answer, q.systemSlug])).toEqual([
      ["B?", false, null, null],
      ["A?", true, "Yes", "s"],
    ]);
    expect((await listQuestions(db, owner, slug, { system: "s" })).map((q) => q.title)).toEqual(["A?"]);
    await setQuestionResolved(db, owner, slug, a.id, false);
    expect((await listQuestions(db, owner, slug, { resolved: false })).map((q) => q.title).sort()).toEqual(["A?", "B?"]);
  });

  it("records who answered a question and when, with the agent that acted", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const a = await addQuestion(db, withAgent(owner, "Claude Code"), slug, { title: "A?" });
    const b = await addQuestion(db, owner, slug, { title: "B?" });
    const before = new Date();
    await answerQuestion(db, editor, slug, { id: a.id, answer: "Yes", resolved: false });
    await answerQuestion(db, withAgent(owner, "Claude Code"), slug, { id: b.id, answer: "No" });
    const byTitle = new Map((await listQuestions(db, owner, slug)).map((q) => [q.title, q]));
    expect(byTitle.get("A?")).toMatchObject({
      author: "Claude Code (for Owner)",
      authorName: "Owner",
      agent: "Claude Code",
      answeredBy: "editor member",
      answeredByName: "editor member",
      answeredAgent: null,
    });
    expect(byTitle.get("B?")).toMatchObject({ authorName: "Owner", agent: null, answeredBy: "Claude Code (for Owner)", answeredByName: "Owner", answeredAgent: "Claude Code" });
    expect(byTitle.get("A?")?.answeredAt?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("leaves the answerer empty until a question is answered", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await addQuestion(db, owner, slug, { title: "A?" });
    expect((await listQuestions(db, owner, slug))[0]).toMatchObject({ answeredBy: null, answeredByName: null, answeredAgent: null, answeredAt: null });
  });

  it("rejects unknown systems and questions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(addQuestion(db, owner, slug, { title: "A?", system: "nope" })).rejects.toMatchObject({ status: 404 });
    await expect(answerQuestion(db, owner, slug, { id: "q", answer: "x" })).rejects.toMatchObject({ status: 404, message: "Unknown question q." });
  });

  it("re-answering a resolved question keeps its resolvedAt", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const a = await addQuestion(db, owner, slug, { title: "A?" });
    await answerQuestion(db, owner, slug, { id: a.id, answer: "Yes", resolved: true });
    const first = (await listQuestions(db, owner, slug))[0].resolvedAt;
    expect(first).not.toBeNull();
    await answerQuestion(db, owner, slug, { id: a.id, answer: "Still yes", resolved: true });
    expect((await listQuestions(db, owner, slug))[0].resolvedAt).toEqual(first);
  });

  it("answering with resolved false re-opens and logs it", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const a = await addQuestion(db, owner, slug, { title: "A?" });
    await answerQuestion(db, owner, slug, { id: a.id, answer: "Yes", resolved: true });
    await answerQuestion(db, owner, slug, { id: a.id, answer: "Maybe", resolved: false });
    expect((await listQuestions(db, owner, slug))[0]).toMatchObject({ resolved: false, resolvedAt: null });
    const rows = (await db.select().from(changeLog)).filter((c) => c.entity === "question" && c.field === "resolved");
    expect(rows.map((c) => ({ entity: c.entity, field: c.field, oldValue: c.oldValue, newValue: c.newValue }))).toContainEqual({
      entity: "question",
      field: "resolved",
      oldValue: "true",
      newValue: "false",
    });
  });

  it("stores a priority and lists blocking questions before older normal ones", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await addQuestion(db, owner, slug, { title: "Older" });
    await addQuestion(db, owner, slug, { title: "Nice", priority: "nice" });
    await addQuestion(db, owner, slug, { title: "Blocker", priority: "blocking" });
    const all = await listQuestions(db, owner, slug);
    expect(all.map((q) => [q.title, q.priority])).toEqual([
      ["Blocker", "blocking"],
      ["Older", "normal"],
      ["Nice", "nice"],
    ]);
  });

  it("sets a priority, logs the change and refuses viewers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const a = await addQuestion(db, owner, slug, { title: "A?", priority: "blocking" });
    await expect(setQuestionPriority(db, viewer, slug, a.id, "nice")).rejects.toBeInstanceOf(ForbiddenError);
    await setQuestionPriority(db, owner, slug, a.id, "nice");
    expect((await listQuestions(db, owner, slug))[0].priority).toBe("nice");
    const rows = (await db.select().from(changeLog)).filter((c) => c.entity === "question" && c.field === "priority");
    expect(rows.map((c) => [c.oldValue, c.newValue])).toEqual([["blocking", "nice"]]);
  });

  it("rejects an unknown priority", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(addQuestion(db, owner, slug, { title: "A?", priority: "urgent" as "nice" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("mentions in questions", () => {
  it("stores @Jules in a question's text as a token and notifies Jules", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    const { id } = await addQuestion(db, owner, slug, { title: "Q?", text: "@Jules can you check" });
    const [q] = await listQuestions(db, owner, slug);
    expect(q.text).toBe(`[@Jules](user:${jules.userId}) can you check`);
    const rows = await db.select().from(notification).where(eq(notification.userId, jules.userId));
    expect(rows.map((r) => [r.kind, r.href, r.sourceKey])).toEqual([["mention", `/p/demo/questions#q-${id}`, `question:${id}:text:mention:${jules.userId}`]]);
  });

  it("stores @Jules in an answer as a token and notifies Jules", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    const { id } = await addQuestion(db, owner, slug, { title: "Q?" });
    await answerQuestion(db, owner, slug, { id, answer: "Ask @Jules" });
    const [q] = await listQuestions(db, owner, slug);
    expect(q.answer).toBe(`Ask [@Jules](user:${jules.userId})`);
    const rows = await db.select().from(notification).where(eq(notification.userId, jules.userId));
    expect(rows.map((r) => [r.kind, r.sourceKey])).toEqual([["mention", `question:${id}:answer:mention:${jules.userId}`]]);
  });
});
