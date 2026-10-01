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

  it("caps the name at 64 characters so the token still parses", () => {
    const token = formatMention("x".repeat(80), C);
    expect(token).toBe(`[@${"x".repeat(64)}](user:${C})`);
    expect(parseMentions(token)).toEqual([{ userId: C, name: "x".repeat(64) }]);
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

  it("ignores tilde fences and an unclosed fence to the end of the text", () => {
    expect(resolveMentionNames("~~~\n@Jules\n~~~ @Jules", members)).toBe(`~~~\n@Jules\n~~~ ${formatMention("Jules", A)}`);
    expect(resolveMentionNames("@Jules\n```\n@Jules", members)).toBe(`${formatMention("Jules", A)}\n\`\`\`\n@Jules`);
    expect(resolveMentionNames("@Jules\n~~~\n@Jules", members)).toBe(`${formatMention("Jules", A)}\n~~~\n@Jules`);
  });

  it("leaves unknown names alone", () => {
    expect(resolveMentionNames("@Nobody hi", members)).toBe("@Nobody hi");
  });

  it("requires a boundary after the name", () => {
    expect(resolveMentionNames("@Julesx hi", members)).toBe("@Julesx hi");
  });

  it("ignores an @ after a digit", () => {
    expect(resolveMentionNames("1@Jules hi", members)).toBe("1@Jules hi");
  });

  it("accepts a closing parenthesis as a boundary", () => {
    expect(resolveMentionNames("(cc @Jules)", members)).toBe(`(cc ${formatMention("Jules", A)})`);
  });

  it("falls back to a shorter name when the longer one has no boundary", () => {
    expect(resolveMentionNames("@Jules Laurentx hi", members)).toBe(`${formatMention("Jules", A)} Laurentx hi`);
  });

  it("matches names containing regex characters literally", () => {
    const odd = [{ userId: A, name: "C++ (dev)" }];
    expect(resolveMentionNames("@C++ (dev) ok", odd)).toBe(`${formatMention("C++ (dev)", A)} ok`);
    expect(resolveMentionNames("@Cxx (dev) ok", odd)).toBe("@Cxx (dev) ok");
  });

  it("matches names whose lowercase form is longer", () => {
    expect(resolveMentionNames("@İsa hi", [{ userId: A, name: "İsa" }])).toBe(`${formatMention("İsa", A)} hi`);
  });

  it("writes only tokens that parse back", () => {
    const long = "L".repeat(70);
    const out = resolveMentionNames(`@${long} hi`, [{ userId: A, name: long }]);
    expect(parseMentions(out)).toEqual([{ userId: A, name: "L".repeat(64) }]);
    expect(resolveMentionNames("@[] hi", [{ userId: B, name: "[]" }])).toBe("@[] hi");
  });

  it("leaves existing tokens alone", () => {
    const out = resolveMentionNames(`[@Jules](user:${A}) and @Jules`, members);
    expect(out).toBe(`[@Jules](user:${A}) and ${formatMention("Jules", A)}`);
    expect(parseMentions(out)).toHaveLength(1);
    expect(out.match(/user:/g)).toHaveLength(2);
  });
});
