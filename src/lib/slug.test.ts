import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("slugify", () => {
  it("lowercases and joins words with single dashes", () => {
    expect(slugify("Player Shops")).toBe("player-shops");
    expect(slugify("  --Hello,   World!--  ")).toBe("hello-world");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("truncates to 64 characters without leaving a trailing dash", () => {
    const result = slugify(`${"a".repeat(63)} b`);
    expect(result).toBe("a".repeat(63));
    expect(result).toMatch(SLUG);
    expect(slugify("word ".repeat(40)).length).toBeLessThanOrEqual(64);
    expect(slugify("word ".repeat(40))).toMatch(SLUG);
  });
});
