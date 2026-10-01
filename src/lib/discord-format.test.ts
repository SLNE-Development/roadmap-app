import { describe, expect, it } from "vitest";
import { buildDigest, buildDiscordMessages, type DiscordItem } from "./discord-format";

const item = (i: number, systemSlug = `sys-${i}`): DiscordItem => ({
  event: "system.done",
  projectName: "Surf",
  projectSlug: "surf",
  systemSlug,
  title: `Change ${i}`,
  detail: "",
  href: `https://roadmap.test/p/surf/systems/${systemSlug}`,
  actorName: "Ammo",
  at: "2026-10-01T09:00:00.000Z",
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("buildDiscordMessages", () => {
  it("puts 3 items into 1 message with 3 embeds", () => {
    const messages = buildDiscordMessages(range(3).map((i) => item(i)));
    expect(messages).toHaveLength(1);
    expect(messages[0].embeds).toHaveLength(3);
    expect(messages[0].embeds[0]).toMatchObject({ title: "Change 1", url: "https://roadmap.test/p/surf/systems/sys-1", color: 0x1a7048, footer: { text: "Surf · Ammo" } });
  });

  it("splits 23 items across 23 systems into messages of 10, 10 and 3", () => {
    const messages = buildDiscordMessages(range(23).map((i) => item(i)));
    expect(messages.map((m) => m.embeds.length)).toEqual([10, 10, 3]);
  });

  it("collapses more than 10 items of one system into one embed", () => {
    const messages = buildDiscordMessages(range(12).map((i) => item(i, "search-index")));
    expect(messages).toHaveLength(1);
    expect(messages[0].embeds).toHaveLength(1);
    const [embed] = messages[0].embeds;
    expect(embed.title).toBe("12 changes on search-index");
    const lines = embed.description?.split("\n") ?? [];
    expect(lines.slice(0, 5)).toEqual(range(5).map((i) => `• Change ${i}`));
    expect(lines).toHaveLength(6);
    expect(embed.description).toMatch(/and 7 more$/);
  });

  it("starts a new message before the embed text passes 6000 characters", () => {
    const messages = buildDiscordMessages(range(10).map((i) => ({ ...item(i), detail: "d".repeat(1024) })));
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.flatMap((m) => m.embeds)).toHaveLength(10);
    for (const m of messages) {
      const total = m.embeds.reduce((sum, e) => sum + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0), 0);
      expect(total).toBeLessThanOrEqual(6000);
    }
  });

  it("cuts a title of 300 characters to 256", () => {
    const [message] = buildDiscordMessages([{ ...item(1), title: "x".repeat(300) }]);
    expect(message.embeds[0].title).toHaveLength(256);
  });

  it("never lets text ping anyone and shows mentions as plain names", () => {
    const [message] = buildDiscordMessages([{ ...item(1), title: "Ask [@Eddie](user:00000000-0000-0000-0000-000000000001) @everyone" }]);
    expect(message.allowed_mentions.parse).toEqual([]);
    expect(message.embeds[0].title).toBe("Ask @Eddie @everyone");
  });
});

describe("buildDigest", () => {
  const empty = { projectName: "Surf", href: "https://roadmap.test/p/surf", shipped: [], started: [], blocked: [], questions: [], accepted: [] };

  it("returns null when every section is empty", () => {
    expect(buildDigest(empty)).toBeNull();
  });

  it("lists the sections with blocking questions first", () => {
    const message = buildDigest({
      ...empty,
      shipped: ["Search index"],
      questions: [
        { title: "Which font?", blocking: false },
        { title: "Which DB?", blocking: true },
      ],
    });
    expect(message?.allowed_mentions.parse).toEqual([]);
    const fields = message?.embeds[0].fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(["Shipped (1)", "Open questions (2)"]);
    expect(fields[1].value).toBe("• Blocking: Which DB?\n• Which font?");
  });

  it("keeps a digest with long sections within 6000 characters", () => {
    const long = Array.from({ length: 10 }, (_, i) => `${i} ${"x".repeat(250)}`);
    const name = "P".repeat(2000);
    const message = buildDigest({ ...empty, projectName: name, shipped: long, started: long, blocked: long, accepted: long, questions: long.map((title) => ({ title, blocking: false })) });
    const [embed] = message?.embeds ?? [];
    const total = (embed.title?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    expect(embed.fields).toHaveLength(5);
    expect(total).toBeLessThanOrEqual(6000);
  });
});
