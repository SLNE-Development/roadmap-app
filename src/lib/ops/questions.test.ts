import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { withAgent } from "./actor";
import { addQuestion, answerQuestion, listQuestions, setQuestionResolved } from "./questions";
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
});
