import { describe, expect, it } from "vitest";
import { answerValueSchema, type AskedLike, askedQuestionInput, askRoundInput, QUESTION_LIMITS, QUESTION_TYPES, validateAsked } from "./event-questions";

const ok = (schema: ReturnType<typeof answerValueSchema>, value: unknown) => schema.safeParse(value).success;

describe("validateAsked", () => {
  it("accepts a valid question of every type", () => {
    expect(QUESTION_TYPES).toHaveLength(8);
    const questions: AskedLike[] = [
      { type: "text", text: "Why?" },
      { type: "choice", text: "Which?", options: ["a", "b"], other: true, suggested: { option: "a" } },
      { type: "multi", text: "Which?", options: ["a", "b", "c"], min: 1, max: 2, suggested: { options: ["a"] } },
      { type: "number", text: "How many?", min: 1, max: 10, unit: "players", suggested: 4 },
      { type: "date", text: "When?", suggested: "2026-12-24" },
      { type: "time", text: "At?", suggested: "18:30" },
      { type: "yesno", text: "Sure?", suggested: true },
      { type: "scale", text: "Rate", max: 10, suggested: 7 },
    ];
    for (const q of questions) expect(validateAsked(q)).toEqual([]);
  });

  it("rejects bad option lists", () => {
    expect(validateAsked({ type: "choice", text: "x", options: ["a"] })).toHaveLength(1);
    expect(validateAsked({ type: "choice", text: "x", options: Array.from({ length: QUESTION_LIMITS.options + 1 }, (_, i) => `o${i}`) })).toHaveLength(1);
    expect(validateAsked({ type: "choice", text: "x", options: ["a", "a"] })).toEqual([expect.stringContaining("options")]);
    expect(validateAsked({ type: "multi", text: "x" })).toEqual([expect.stringContaining("options")]);
  });

  it("rejects bounds that do not fit the type", () => {
    expect(validateAsked({ type: "multi", text: "x", options: ["a", "b", "c"], min: 3, max: 2 })).toEqual([expect.stringContaining("min")]);
    expect(validateAsked({ type: "multi", text: "x", options: ["a", "b"], min: 3 })).toEqual([expect.stringContaining("min")]);
    expect(validateAsked({ type: "multi", text: "x", options: ["a", "b"], other: true, min: 3 })).toEqual([]);
    expect(validateAsked({ type: "multi", text: "x", options: ["a", "b"], other: true, min: 4 })).toEqual([expect.stringContaining("min")]);
    expect(validateAsked({ type: "scale", text: "x", max: 7 })).toEqual([expect.stringContaining("max")]);
    expect(validateAsked({ type: "scale", text: "x", min: 2 })).toEqual([expect.stringContaining("min")]);
    expect(validateAsked({ type: "number", text: "x", min: 5, max: 1 })).toEqual([expect.stringContaining("min")]);
  });

  it("names a field the type does not allow", () => {
    expect(validateAsked({ type: "text", text: "x", unit: "kg" })).toEqual([expect.stringContaining("unit")]);
    expect(validateAsked({ type: "text", text: "x", options: ["a", "b"] })).toEqual([expect.stringContaining("options")]);
    expect(validateAsked({ type: "yesno", text: "x", other: true })).toEqual([expect.stringContaining("other")]);
    expect(validateAsked({ type: "date", text: "x", min: 1 })).toEqual([expect.stringContaining("min")]);
  });

  it("rejects a suggested value that is not a valid answer", () => {
    expect(validateAsked({ type: "choice", text: "x", options: ["a", "b"], suggested: { option: "z" } })).toEqual([expect.stringContaining("suggested")]);
    expect(validateAsked({ type: "number", text: "x", max: 5, suggested: 9 })).toEqual([expect.stringContaining("suggested")]);
  });
});

describe("askedQuestionInput and askRoundInput", () => {
  it("defaults required to true and reports validateAsked errors as issues", () => {
    expect(askedQuestionInput.parse({ type: "text", text: "Why?" })).toMatchObject({ required: true });
    const bad = askedQuestionInput.safeParse({ type: "text", text: "x", unit: "kg" });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("unit");
  });

  it("takes one to five questions", () => {
    const q = { type: "text", text: "Why?" };
    expect(askRoundInput.safeParse({ questions: [] }).success).toBe(false);
    expect(askRoundInput.safeParse({ questions: Array(5).fill(q) }).success).toBe(true);
    expect(askRoundInput.safeParse({ questions: Array(6).fill(q) }).success).toBe(false);
  });
});

describe("answerValueSchema", () => {
  it("checks a choice against the options and the other flag", () => {
    const closed = answerValueSchema({ type: "choice", options: ["a", "b"], other: false });
    expect(ok(closed, { option: "a" })).toBe(true);
    expect(ok(closed, { option: "z" })).toBe(false);
    expect(ok(closed, { other: "mine" })).toBe(false);
    expect(ok(answerValueSchema({ type: "choice", options: ["a", "b"], other: true }), { other: "mine" })).toBe(true);
  });

  it("checks the number of selections of a multi", () => {
    const multi = answerValueSchema({ type: "multi", options: ["a", "b", "c"], min: 1, max: 2 });
    expect(ok(multi, { options: [] })).toBe(false);
    expect(ok(multi, { options: ["a"] })).toBe(true);
    expect(ok(multi, { options: ["a", "b", "c"] })).toBe(false);
    expect(ok(multi, { options: ["a", "z"] })).toBe(false);
    expect(ok(multi, { options: ["a", "a"] })).toBe(false);
    expect(ok(answerValueSchema({ type: "multi", options: ["a", "b"], other: true, max: 2 }), { options: ["a"], other: "x" })).toBe(true);
  });

  it("checks numbers, dates and times", () => {
    const num = answerValueSchema({ type: "number", min: 0, max: 10 });
    expect(ok(num, 10)).toBe(true);
    expect(ok(num, 11)).toBe(false);
    expect(ok(num, Number.NaN)).toBe(false);
    expect(ok(num, "5")).toBe(false);
    const date = answerValueSchema({ type: "date" });
    expect(ok(date, "2026-02-28")).toBe(true);
    expect(ok(date, "2026-02-30")).toBe(false);
    expect(ok(date, "26-02-01")).toBe(false);
    const time = answerValueSchema({ type: "time" });
    expect(ok(time, "23:59")).toBe(true);
    expect(ok(time, "24:00")).toBe(false);
  });

  it("checks text, yes/no and scale", () => {
    expect(ok(answerValueSchema({ type: "text" }), "hello")).toBe(true);
    expect(ok(answerValueSchema({ type: "text" }), "x".repeat(2001))).toBe(false);
    const yn = answerValueSchema({ type: "yesno" });
    expect(ok(yn, false)).toBe(true);
    expect(ok(yn, "yes")).toBe(false);
    expect(ok(yn, 1)).toBe(false);
    const scale = answerValueSchema({ type: "scale", max: 5 });
    expect(ok(scale, 1)).toBe(true);
    expect(ok(scale, 5)).toBe(true);
    expect(ok(scale, 0)).toBe(false);
    expect(ok(scale, 6)).toBe(false);
    expect(ok(scale, 2.5)).toBe(false);
    expect(ok(answerValueSchema({ type: "scale" }), 5)).toBe(true);
    expect(ok(answerValueSchema({ type: "scale" }), 6)).toBe(false);
  });
});
