// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import type { Embed } from "@/lib/discord-limits";
import en from "../../../messages/en";
import { DiscordPreview } from "./discord-preview";

afterEach(cleanup);

const embed: Embed = { title: "Game night", description: "Starts <t:1791050400:t>", color: "#5865f2", imageUploadId: "up1", imageAs: "thumbnail", fields: [], footer: "Footer text" };

/** Renders the parts for a German viewer in Berlin. */
function show(parts: React.ComponentProps<typeof DiscordPreview>["parts"], avatarUrl?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DiscordPreview parts={parts} postAs="Roadmap" avatarUrl={avatarUrl} locale="de-DE" timeZone="Europe/Berlin" />
    </NextIntlClientProvider>,
  );
}

describe("DiscordPreview", () => {
  it("shows the sender image instead of the letter circle", () => {
    const { container } = show([{ kind: "text", content: "Hi" }], "/api/uploads/av1");
    expect(container.querySelector('img[src="/api/uploads/av1"]')).not.toBeNull();
    expect(screen.queryByText("R")).toBeNull();
    cleanup();
    show([{ kind: "text", content: "Hi" }]);
    expect(screen.getByText("R")).toBeTruthy();
  });

  it("renders timestamp tokens as local time", () => {
    show([{ kind: "text", content: "Tonight at <t:1791050400:t>" }]);
    expect(screen.getByText(/20:00/)).toBeTruthy();
  });

  it("shows the lines of an embed description on separate lines", () => {
    const { container } = show([{ kind: "embed", content: "", embed: { ...embed, description: "Datum: 1.\nUhrzeit: 2." } }]);
    expect(container.querySelectorAll("br").length).toBe(1);
  });

  it("shows a thumbnail embed with its upload", () => {
    const { container } = show([{ kind: "embed", content: "", embed }]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/uploads/up1");
    expect(screen.getByText("Game night")).toBeTruthy();
    expect(screen.getByText(/20:00/)).toBeTruthy();
    expect(screen.getByText("Footer text")).toBeTruthy();
  });

  it("renders a role mention as a pill", () => {
    show([{ kind: "text", content: "Hello <@&123456>" }]);
    expect(screen.getByText("@Event")).toBeTruthy();
  });

  it("shows the event link as a Discord event card", () => {
    show([{ kind: "event-link", content: "https://discord.com/events/1/2" }]);
    expect(screen.getByText("Discord event")).toBeTruthy();
    expect(screen.getByText("https://discord.com/events/1/2")).toBeTruthy();
  });
});
