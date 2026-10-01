import { describe, expect, it } from "vitest";
import { countEmbedChars, fitsMessage, LIMITS, splitText, textLength, type Embed } from "./discord-limits";

const embed = (over: Partial<Embed> = {}): Embed => ({ title: "", description: "", color: "#2a5db0", imageUploadId: null, fields: [], footer: "", ...over });
const strip = (s: string) => s.replace(/\s+/g, "");
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("textLength", () => {
  it("counts code points, not code units", () => {
    expect(textLength("😀".repeat(1001))).toBe(1001);
  });
});

describe("splitText", () => {
  it("splits 15 paragraphs of 300 characters into 3 chunks at blank lines", () => {
    const paragraphs = Array.from({ length: 15 }, (_, i) => `P${i} ` + "x".repeat(295));
    const text = paragraphs.join("\n\n");
    const chunks = splitText(text);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(textLength(c)).toBeLessThanOrEqual(2000);
    expect(chunks.map((c) => c.split("\n\n").length)).toEqual([6, 6, 3]);
    expect(strip(chunks.join("\n\n"))).toBe(strip(text));
  });

  it("splits one long paragraph at sentence ends, then hard", () => {
    const sentence = "Dies ist ein Satz mit etwas Text. ";
    const text = sentence.repeat(150).trim();
    const chunks = splitText(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(textLength(c)).toBeLessThanOrEqual(2000);
      expect(c.endsWith(".")).toBe(true);
    }
    expect(strip(chunks.join(" "))).toBe(strip(text));
    const hard = splitText("y".repeat(5000));
    expect(hard.map(textLength)).toEqual([2000, 2000, 1000]);
    expect(hard.join("")).toBe("y".repeat(5000));
  });

  it("falls back to the last space before a hard cut", () => {
    const text = "wort ".repeat(900).trim();
    const chunks = splitText(text);
    for (const c of chunks) expect(c.startsWith("wort") && c.endsWith("wort")).toBe(true);
    expect(strip(chunks.join(" "))).toBe(strip(text));
  });

  it("keeps a heading with the paragraph that follows it", () => {
    const body = "a".repeat(1500);
    const text = `${body}\n\n# Titel\n\n${"b".repeat(800)}`;
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(body);
    expect(chunks[1].startsWith("# Titel\n\nbbb")).toBe(true);
  });

  it("keeps a heading with the start of a paragraph that has to be split", () => {
    const text = `# Titel\n\n${"Satz eins. ".repeat(400)}`;
    const chunks = splitText(text);
    expect(chunks[0].startsWith("# Titel\n\nSatz")).toBe(true);
    expect(strip(chunks.join("\n\n"))).toBe(strip(text));
  });

  it("never splits an emoji at the limit", () => {
    const text = "a".repeat(1999) + "😀😀" + "b".repeat(100);
    const chunks = splitText(text);
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) expect(c).not.toMatch(LONE_SURROGATE);
    expect(chunks.map(textLength)).toEqual([2000, 101]);
  });

  it("does not cut inside a markdown link or a custom emoji when avoidable", () => {
    const link = "[Regeln lesen](https://example.com/regeln)";
    const text = "a".repeat(1980) + link + " " + "b".repeat(50);
    expect(splitText(text).some((c) => c.includes(link))).toBe(true);
    const emoji = "<:pog:123456789012345678>";
    const text2 = "c".repeat(1990) + emoji + "d".repeat(50);
    expect(splitText(text2).some((c) => c.includes(emoji))).toBe(true);
  });

  it("drops empty chunks and trims", () => {
    expect(splitText("  \n\n \n\n")).toEqual([]);
    expect(splitText("  eins  \n\n\n\n  zwei  ")).toEqual(["eins\n\nzwei"]);
  });

  it("uses a smaller first chunk when asked", () => {
    const text = "x".repeat(1900) + "\n\n" + "y".repeat(100);
    const chunks = splitText(text, 2000, 1500);
    expect(chunks.every((c) => textLength(c) <= 2000)).toBe(true);
    expect(textLength(chunks[0])).toBeLessThanOrEqual(1500);
    expect(strip(chunks.join(""))).toBe(strip(text));
  });
});

describe("countEmbedChars and fitsMessage", () => {
  it("adds title, description, fields, footer and author", () => {
    expect(countEmbedChars(embed({ title: "ab", description: "cde", fields: [{ name: "f", value: "gh" }], footer: "i", author: "jk" }))).toBe(2 + 3 + 1 + 2 + 1 + 2);
  });

  it("accepts a message at the limits", () => {
    expect(fitsMessage({ content: "a".repeat(2000), embeds: [embed({ description: "b".repeat(4000) })] })).toBe(true);
  });

  it("fails for 2,001 characters of content", () => {
    expect(fitsMessage({ content: "a".repeat(2001) })).toBe(false);
  });

  it("fails when all embeds together exceed 6,000", () => {
    const e = embed({ description: "a".repeat(3001) });
    expect(fitsMessage({ embeds: [e, e] })).toBe(false);
  });

  it("fails for 11 embeds and for 26 fields", () => {
    expect(fitsMessage({ embeds: Array.from({ length: 11 }, () => embed({ title: "t" })) })).toBe(false);
    expect(fitsMessage({ embeds: [embed({ fields: Array.from({ length: 26 }, () => ({ name: "n", value: "v" })) })] })).toBe(false);
  });

  it("checks each per-field limit", () => {
    expect(fitsMessage({ embeds: [embed({ title: "a".repeat(LIMITS.embedTitle + 1) })] })).toBe(false);
    expect(fitsMessage({ embeds: [embed({ description: "a".repeat(LIMITS.embedDescription + 1) })] })).toBe(false);
    expect(fitsMessage({ embeds: [embed({ fields: [{ name: "a".repeat(257), value: "v" }] })] })).toBe(false);
    expect(fitsMessage({ embeds: [embed({ fields: [{ name: "n", value: "a".repeat(1025) }] })] })).toBe(false);
    expect(fitsMessage({ embeds: [embed({ footer: "a".repeat(2049) })] })).toBe(false);
  });

  it("counts emoji as code points", () => {
    expect(fitsMessage({ content: "😀".repeat(2000) })).toBe(true);
  });
});
