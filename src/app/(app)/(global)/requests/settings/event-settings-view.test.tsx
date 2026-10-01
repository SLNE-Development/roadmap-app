// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { calls, fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });

const { EventSettingsView } = await import("./event-settings-view");

afterEach(cleanup);

const embed = (title: string, imageUploadId: string | null = null) => ({ title, text: "{event} text", color: "#c23636", imageUploadId });
const secret = { set: false, hint: null };
const settings = {
  postAs: "Roadmap",
  pingRoleId: null,
  guildId: null,
  timeZone: "Europe/Berlin",
  rulebookUrl: null,
  announcementStyle: "",
  announcementExample: "",
  reminderExample: "",
  teamStyle: "",
  teamExample: "",
  disasterTemplate: embed("Störfall", "img1"),
  resolvedTemplate: embed("Entwarnung"),
  cancelledTemplate: embed("Abgesagt"),
  detailsTemplate: { lines: ["Start: {start}"], color: "#2a5db0", footer: "" },
  updatedAt: new Date("2026-10-01T10:00:00Z"),
  botStatus: null,
  botCheckedAt: null,
  secrets: { publicWebhook: secret, teamWebhook: secret, staffWebhook: secret, botToken: secret },
};

/** Registers the handlers for a viewer with the given roles. */
function as(me: { isAdmin?: boolean; isEventManager?: boolean }) {
  handlers["account.me"] = () => ({ isAdmin: false, isEventManager: false, ...me });
}

beforeEach(() => {
  resetTRPC();
  as({ isEventManager: true });
  handlers["requests.settings.get"] = () => settings;
  handlers["requests.settings.update"] = () => ({});
  handlers["requests.settings.preview"] = ((input: { kind: string; template: { title: string; text: string; color: string; imageUploadId: string | null } }) =>
    input.kind === "details" ? { kind: "details", lines: ["Start"], color: "#2a5db0", footer: "" } : { kind: "embed", ...input.template }) as never;
});

/** Renders the page in providers that stay the same across refetches. */
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <TooltipProvider>
          <Suspense fallback={null}>
            <EventSettingsView />
          </Suspense>
        </TooltipProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The card of a section, by its anchor id. */
const card = (id: string) => document.getElementById(id) as HTMLElement;

describe("EventSettingsView", () => {
  it("has the Störfall image upload for managers and none in the resolved editor", async () => {
    setup();
    await screen.findByText("Störfall message", { selector: "h2" });
    expect(within(card("disaster")).getByRole("button", { name: "Replace image" })).toBeTruthy();
    expect(within(card("resolved")).queryByRole("button", { name: /image/i })).toBeNull();
    expect(within(card("resolved")).queryByText("Störfall image")).toBeNull();
    expect(within(card("cancelled")).queryByText("Störfall image")).toBeNull();
  });

  it("hides the upload from readers", async () => {
    as({});
    setup();
    await screen.findByText("Störfall message", { selector: "h2" });
    expect(within(card("disaster")).queryByRole("button", { name: "Replace image" })).toBeNull();
  });

  it("updates the preview when the title is typed", async () => {
    setup();
    await screen.findByText("Cancelled message", { selector: "h2" });
    const title = within(card("cancelled")).getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Event abgesagt!" } });
    await waitFor(() => expect(within(card("cancelled")).getByText("Event abgesagt!", { selector: "span" })).toBeTruthy(), { timeout: 3000 });
  });

  it("saves one section alone", async () => {
    setup();
    await screen.findByText("Cancelled message", { selector: "h2" });
    fireEvent.change(within(card("cancelled")).getByLabelText("Title"), { target: { value: "Neu" } });
    fireEvent.change(within(card("posting")).getByLabelText("Post as"), { target: { value: "Events" } });
    fireEvent.click(within(card("cancelled")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls["requests.settings.update"]).toHaveLength(1));
    expect(calls["requests.settings.update"][0]).toEqual({ cancelledTemplate: { ...settings.cancelledTemplate, title: "Neu" } });
    await waitFor(() => expect(within(card("cancelled")).queryByText("Unsaved changes")).toBeNull());
    expect(within(card("posting")).getByText("Unsaved changes")).toBeTruthy();
  });

  it("lists the placeholders with their meaning, with {note} where it is allowed", async () => {
    setup();
    await screen.findByText("Cancelled message", { selector: "h2" });
    expect(within(card("cancelled")).getByText("The note written when posting or cancelling")).toBeTruthy();
    expect(within(card("details")).queryByText("The note written when posting or cancelling")).toBeNull();
  });
});
