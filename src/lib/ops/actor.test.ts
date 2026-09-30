import { describe, expect, it } from "vitest";
import { authorFields, authorLabel, withAgent } from "./actor";

describe("actor", () => {
  it("labels agent writes with the person they act for", () => {
    expect(authorLabel("Alex", "Claude Code")).toBe("Claude Code (for Alex)");
    expect(authorLabel("Alex", null)).toBe("Alex");
    expect(authorLabel(null, null)).toBe("unknown");
    expect(authorLabel(null, "Claude Code")).toBe("Claude Code (for unknown)");
  });

  it("returns the label, the person and the agent as separate fields", () => {
    expect(authorFields("Alex", "Claude Code")).toEqual({ author: "Claude Code (for Alex)", authorName: "Alex", agent: "Claude Code" });
    expect(authorFields("  Alex ", null)).toEqual({ author: "Alex", authorName: "Alex", agent: null });
    expect(authorFields(null, undefined)).toEqual({ author: "unknown", authorName: "unknown", agent: null });
  });

  it("attaches a trimmed agent name of at most 40 characters, ignoring blanks", () => {
    const actor = { userId: "u", name: "Alex", isAdmin: false };
    expect(withAgent(actor, "  Claude Code ").agent).toBe("Claude Code");
    expect(withAgent(actor, "x".repeat(50)).agent).toHaveLength(40);
    expect(withAgent(actor, "   ")).toEqual(actor);
    expect(withAgent(actor, undefined)).toEqual(actor);
  });
});
