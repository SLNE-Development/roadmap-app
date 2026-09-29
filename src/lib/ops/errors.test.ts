import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConflictError, ForbiddenError, InvalidError, isUniqueViolation, messageOf, NotFoundError, statusOf } from "./errors";

describe("ops errors", () => {
  it("maps each error class to its HTTP status", () => {
    expect(statusOf(new InvalidError("x"))).toBe(400);
    expect(statusOf(new ForbiddenError("x"))).toBe(403);
    expect(statusOf(new NotFoundError("x"))).toBe(404);
    expect(statusOf(new ConflictError("x"))).toBe(409);
    expect(statusOf(new Error("x"))).toBe(500);
  });

  it("treats zod errors as invalid input and lists every issue with its path", () => {
    const result = z.object({ title: z.string().min(1), n: z.number() }).safeParse({ title: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(statusOf(result.error)).toBe(400);
    expect(messageOf(result.error)).toMatch(/^title: .+; n: .+$/);
  });

  it("hides the message of unexpected errors", () => {
    expect(messageOf(new Error("password=hunter2"))).toBe("Something went wrong.");
  });

  it("detects a unique violation directly or wrapped in a cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("wrapped", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error("other", { cause: { code: "23503" } }))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
