import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
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

  it("rejects unknown systems and questions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(addQuestion(db, owner, slug, { title: "A?", system: "nope" })).rejects.toMatchObject({ status: 404 });
    await expect(answerQuestion(db, owner, slug, { id: "q", answer: "x" })).rejects.toMatchObject({ status: 404, message: "Unknown question q." });
  });
});
