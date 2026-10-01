import { describe, expect, it } from "vitest";
import { formatMention, mentionsToPlain, newMentions, parseMentions, resolveMentionNames } from "./mentions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const members = [
  { userId: A, name: "Jules" },
  { userId: B, name: "Jules Laurent" },
  { userId: C, name: "Rik" },
  { userId: D, name: "rik" },
];

describe("mention tokens", () => {
  it("formats a token and strips brackets and newlines from the name", () => {
    expect(formatMention("Ri]k\n", C)).toBe(`[@Rik](user:${C})`);
  });

  it("parses unique mentions in order", () => {
    const found = parseMentions(`hi [@Rik](user:${C}) and [@Rik](user:${C}) and [@Jules](user:${A})`);
    expect(found).toEqual([
      { userId: C, name: "Rik" },
      { userId: A, name: "Jules" },
    ]);
  });

  it("turns tokens into plain @Name", () => {
    expect(mentionsToPlain(`ping [@Jules](user:${A}).`)).toBe("ping @Jules.");
  });

  it("returns only ids that are new", () => {
    expect(newMentions(`[@Jules](user:${A})`, `[@Jules](user:${A}) [@Rik](user:${C})`)).toEqual([C]);
    expect(newMentions(null, `[@Jules](user:${A})`)).toEqual([A]);
  });
});

describe("resolveMentionNames", () => {
  it("prefers the longest matching name", () => {
    expect(resolveMentionNames("@Jules Laurent can you check", members)).toBe(`${formatMention("Jules Laurent", B)} can you check`);
  });

  it("accepts trailing punctuation as a boundary", () => {
    expect(resolveMentionNames("@Jules, please", members)).toBe(`${formatMention("Jules", A)}, please`);
  });

  it("leaves ambiguous names alone", () => {
    expect(resolveMentionNames("@rik look", members)).toBe("@rik look");
  });

  it("ignores email addresses", () => {
    expect(resolveMentionNames("mail me at a@Jules.dev", members)).toBe("mail me at a@Jules.dev");
  });

  it("ignores inline code and fenced blocks", () => {
    expect(resolveMentionNames("run `@Jules` literally", members)).toBe("run `@Jules` literally");
    expect(resolveMentionNames("```\n@Jules\n```", members)).toBe("```\n@Jules\n```");
  });

  it("leaves unknown names alone", () => {
    expect(resolveMentionNames("@Nobody hi", members)).toBe("@Nobody hi");
  });

  it("requires a boundary after the name", () => {
    expect(resolveMentionNames("@Julesx hi", members)).toBe("@Julesx hi");
  });

  it("leaves existing tokens alone", () => {
    const out = resolveMentionNames(`[@Jules](user:${A}) and @Jules`, members);
    expect(out).toBe(`[@Jules](user:${A}) and ${formatMention("Jules", A)}`);
    expect(parseMentions(out)).toHaveLength(1);
    expect(out.match(/user:/g)).toHaveLength(2);
  });
});
