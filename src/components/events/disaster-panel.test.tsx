// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISASTER_TEMPLATE, DEFAULT_RESOLVED_TEMPLATE } from "@/lib/event-templates";
import { fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { DisasterPanel } = await import("./disaster-panel");

afterEach(cleanup);

const progress = { id: "p1", status: "posted", lastError: null, partsCount: 1, sentCount: 1, stale: false };

/** The disaster state; `posted` puts a live disaster post in it. */
const state = (posted: boolean) => ({
  canAct: true,
  hookSet: true,
  post: posted ? { ...progress, resolvedAt: null } : null,
  resolved: null,
  template: { disaster: DEFAULT_DISASTER_TEMPLATE, resolved: DEFAULT_RESOLVED_TEMPLATE, imageUploadId: null },
  request: { title: "Summer Cup", startsAt: new Date("2026-10-10T18:00:00Z"), durationMinutes: 120, where: "Lobby", eventDocsUrl: null, bannerUploadId: null, summary: "" },
  timeZone: "UTC",
  rulebookUrl: null,
});

let posted = false;
beforeEach(() => {
  resetTRPC();
  posted = false;
  handlers["requests.posts.disasterState"] = () => state(posted);
  handlers["requests.settings.get"] = () => ({ postAs: "Events", timeZone: "UTC" });
});

/** Renders the panel in providers that stay the same across refetches. */
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DisasterPanel requestId="r1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("DisasterPanel", () => {
  it("shows the note in the live preview of the post dialog", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Post disaster message" }));
    const note = (await screen.findByLabelText("Note for the players (optional)")) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "Back in an hour" } });
    const preview = screen.getByRole("group", { name: "Discord message preview" });
    expect(preview.textContent).toContain("Back in an hour");
  });

  it("keeps the resolve dialog open and the text intact while the state refetches between keystrokes", async () => {
    posted = true;
    const client = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    const text = "twenty characters!!!";
    expect(text).toHaveLength(20);
    for (let i = 1; i <= text.length; i++) {
      const note = screen.getByLabelText("Note for the players (optional)") as HTMLTextAreaElement;
      fireEvent.change(note, { target: { value: text.slice(0, i) } });
      await act(() => client.invalidateQueries());
    }
    const note = screen.getByLabelText("Note for the players (optional)") as HTMLTextAreaElement;
    expect(note.value).toBe(text);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Discord message preview" }).textContent).toContain(text);
  });
});
