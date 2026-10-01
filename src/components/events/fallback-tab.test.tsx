// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { calls, fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import de from "../../../messages/de";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { FallbackTab } = await import("./fallback-tab");

afterEach(cleanup);

/** A scenario row; only the fields the tab reads. */
const scenario = (id: string, title: string, over: object = {}) => ({ id, key: null, title, required: false, whatWeDo: "", whoDecides: "", playerMessage: null, ...over });

let rows: ReturnType<typeof scenario>[] = [];
beforeEach(() => {
  resetTRPC();
  rows = [scenario("a", "Server down", { required: true }), scenario("b", "No staff")];
  handlers["requests.fallbacks"] = () => rows;
  handlers["requests.saveFallback"] = () => ({});
});

/** Renders the tab in providers that stay the same across refetches. */
function setup(locale: "en" | "de" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
        <TooltipProvider>
          <Suspense fallback={null}>
            <FallbackTab requestId="r1" canEdit />
          </Suspense>
        </TooltipProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return client;
}

/** The "Who decides" input of the card at `index`. */
const who = (index: number) => screen.getAllByLabelText("Who decides")[index] as HTMLInputElement;

describe("FallbackTab", () => {
  it("shows the required scenario title translated and keeps a custom title as written", async () => {
    rows = [scenario("a", "Server dies mid-event", { required: true, key: "server-down" }), scenario("b", "Server dies mid-event")];
    setup("de");
    await screen.findAllByLabelText("Wer entscheidet");
    expect(screen.getByRole("heading", { name: /Server fällt während des Events aus/ })).toBeTruthy();
    expect((screen.getByLabelText("Titel des Szenarios") as HTMLInputElement).value).toBe("Server dies mid-event");
  });

  it("keeps typed text when a refetch changes another scenario", async () => {
    const client = setup();
    await screen.findAllByLabelText("Who decides");
    fireEvent.change(who(0), { target: { value: "The lead" } });
    rows = [rows[0], scenario("b", "No staff", { whatWeDo: "Call the backup", whoDecides: "Ops" })];
    await act(() => client.invalidateQueries());
    expect(who(0).value).toBe("The lead");
    expect(screen.getAllByText("Unsaved changes")).toHaveLength(1);
  });

  it("saving one card leaves the unsaved text of another", async () => {
    setup();
    await screen.findAllByLabelText("Who decides");
    fireEvent.change(who(0), { target: { value: "The lead" } });
    fireEvent.change(who(1), { target: { value: "Ops" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(calls["requests.saveFallback"]).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByText("Unsaved changes")).toHaveLength(1));
    expect(who(0).value).toBe("The lead");
    expect(who(1).value).toBe("Ops");
  });
});
