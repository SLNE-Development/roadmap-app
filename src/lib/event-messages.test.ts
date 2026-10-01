import { describe, expect, it } from "vitest";
import { DEFAULT_DETAILS_TEMPLATE, DEFAULT_DISASTER_TEMPLATE, DEFAULT_RESOLVED_TEMPLATE } from "./event-templates";
import { buildDetailsEmbed, buildDisasterEmbed, buildResolvedEmbed, GERMAN, plannedParts, type PlanSettings } from "./event-messages";
import { textLength } from "./discord-limits";

const ROLE = "123456789012345678";
const request = { title: "Piratenfest", startsAt: new Date("2026-10-17T16:00:00Z"), durationMinutes: 90, where: "Hafenwelt", eventDocsUrl: "https://example.com/infos", bannerUploadId: null as string | null };
const settings: PlanSettings = {
  pingRoleId: ROLE,
  timeZone: "Europe/Berlin",
  rulebookUrl: "https://example.com/regeln",
  detailsTemplate: DEFAULT_DETAILS_TEMPLATE,
  disasterTemplate: DEFAULT_DISASTER_TEMPLATE,
  resolvedTemplate: DEFAULT_RESOLVED_TEMPLATE,
};
const post = (over: Partial<Parameters<typeof plannedParts>[0]> = {}) => ({ kind: "announcement" as const, text: "", embed: null, pingRole: false, note: null, ...over });
const long = (paragraphs: number) => ["# Piratenfest", ...Array.from({ length: paragraphs }, (_, i) => `Absatz ${i} ` + "x".repeat(380))].join("\n\n");
const none = { discordEventUrl: null };

describe("buildDetailsEmbed", () => {
  it("fills the template lines and links the event docs", () => {
    const e = buildDetailsEmbed(request, settings);
    expect(e.title).toBe("Piratenfest");
    expect(e.url).toBe("https://example.com/infos");
    expect(e.description).toContain("Ort: Hafenwelt");
    expect(e.description).toContain("Uhrzeit: 18:00 Uhr");
    expect(e.footer).toBe("Viel Spaß!");
    expect(e.imageUploadId).toBeNull();
  });

  it("uses the banner as the image", () => {
    expect(buildDetailsEmbed({ ...request, bannerUploadId: "up1" }, settings).imageUploadId).toBe("up1");
  });
});

describe("disaster and resolved embeds", () => {
  it("fill the templates, the note only in the resolved one", () => {
    expect(buildDisasterEmbed(request, settings).description).toContain("Piratenfest ist gerade nicht erreichbar");
    const resolved = buildResolvedEmbed(request, settings, "Alles gut.");
    expect(resolved.description).toBe("Piratenfest läuft wieder. Alles gut.");
    expect(resolved.title).toBe("Das Event ist nun wieder online");
  });
});

describe("plannedParts", () => {
  it("makes 2 text parts and an event card from a 3,900 character announcement with a ping", () => {
    const text = long(9);
    expect(textLength(text)).toBeGreaterThan(3500);
    const parts = plannedParts(post({ text, pingRole: true }), request, settings, none);
    expect(parts.map((p) => p.kind)).toEqual(["text", "text", "embed"]);
    expect(parts[0].content.startsWith(`<@&${ROLE}>`)).toBe(true);
    expect(parts[0].content).toContain("# Piratenfest");
    expect(parts.every((p) => p.messageId === null && p.sentAt === null)).toBe(true);
    for (const p of parts.slice(0, 2)) expect(textLength(p.content)).toBeLessThanOrEqual(2000);
    expect(parts[2].embed?.description).toContain("Ort: Hafenwelt");
    expect(parts[2].content).toBe("");
  });

  it("ends with an event-link part holding exactly the event url", () => {
    const url = "https://discord.com/events/1/2";
    const parts = plannedParts(post({ text: "Hallo" }), request, settings, { discordEventUrl: url });
    expect(parts.map((p) => p.kind)).toEqual(["text", "event-link"]);
    expect(parts[1].content).toBe(url);
  });

  it("lets an explicit embed replace the generated card", () => {
    const embed = { title: "Eigene Karte", description: "d", color: "#c23636", imageUploadId: "u9", fields: [], footer: "" };
    const parts = plannedParts(post({ text: "Hallo", embed }), request, settings, none);
    expect(parts[1].embed?.title).toBe("Eigene Karte");
    expect(parts[1].uploadId).toBe("u9");
  });

  it("reduces the first chunk by the mention so it still fits 2,000", () => {
    const parts = plannedParts(post({ text: "a".repeat(1995), pingRole: true }), request, settings, none);
    const texts = parts.filter((p) => p.kind === "text");
    expect(texts.every((p) => textLength(p.content) <= 2000)).toBe(true);
    expect(texts[0].content.startsWith(`<@&${ROLE}>`)).toBe(true);
    expect(texts).toHaveLength(2);
  });

  it("pings only for announcement, and for reminder when chosen", () => {
    const has = (p: ReturnType<typeof plannedParts>) => p[0].content.includes("<@&");
    expect(has(plannedParts(post({ kind: "team", text: "x", pingRole: true }), request, settings, none))).toBe(false);
    expect(has(plannedParts(post({ kind: "reminder", text: "x" }), request, settings, none))).toBe(false);
    expect(has(plannedParts(post({ kind: "reminder", text: "x", pingRole: true }), request, settings, none))).toBe(true);
    expect(has(plannedParts(post({ text: "x", pingRole: true }), request, { ...settings, pingRoleId: null }, none))).toBe(false);
  });

  it("ends a team notice with the details embed, never the event link", () => {
    expect(plannedParts(post({ kind: "team", text: "Team" }), request, settings, none).map((p) => p.kind)).toEqual(["text", "embed"]);
    expect(plannedParts(post({ kind: "team", text: "Team" }), request, settings, { discordEventUrl: "https://discord.com/events/1/2" }).map((p) => p.kind)).toEqual(["text", "embed"]);
  });

  it("names the part that breaks the limits", () => {
    const embed = { title: "t", description: "d".repeat(4097), color: "#c23636", imageUploadId: null, fields: [], footer: "" };
    expect(() => plannedParts(post({ text: "Hallo", embed }), request, settings, none)).toThrow(/part 2/);
  });
});

describe("GERMAN", () => {
  it("holds the test marker", () => {
    expect(GERMAN.testMarker).toBe("Testnachricht (nur für das Team)");
  });
});
