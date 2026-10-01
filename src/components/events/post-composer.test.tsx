// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PostsView, PostView } from "@/lib/ops/request-posts";
import { fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { MessagesTab } = await import("./post-composer");

afterEach(cleanup);

const NOW = new Date("2026-10-01T10:00:00Z");

/** A saved announcement; the other kinds have no post. */
const post = (over: Partial<PostView> = {}): PostView => ({
  id: "p1", kind: "announcement", status: "draft", text: "Saved text", embed: null, pingRole: false, note: null, partsCount: 0, sentCount: 0, lastError: null,
  postedAt: null, postedByName: null, updatedAt: NOW, dueAt: null, late: false, stale: false, ...over,
});

/** The view the list returns for `posts`. */
const view = (posts: PostView[]): PostsView => ({
  posts, targets: { team: true, public: true, staff: true }, pingRoleSet: true,
  dues: { team: { dueAt: null, late: false }, announcement: { dueAt: null, late: false }, reminder: { dueAt: null, late: false } },
});

/** Renders the tab and returns its query client. */
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <TooltipProvider>
          <Suspense fallback={null}>
            <MessagesTab requestId="r1" requestStatus="accepted" canEdit />
          </Suspense>
        </TooltipProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return client;
}

/** The announcement's editor: the second of the three cards. */
const editor = async () => ((await screen.findAllByRole("textbox"))[1] as HTMLTextAreaElement);

describe("MessagesTab", () => {
  beforeEach(() => {
    resetTRPC();
    handlers["requests.posts.list"] = () => view([post()]);
    handlers["requests.posts.preview"] = () => ({ parts: [{ kind: "text", content: "Saved text", length: 10, sent: false }], embeds: [] });
    handlers["requests.settings.get"] = () => ({ postAs: "Events", timeZone: "UTC" });
  });

  it("shows the save-first hint exactly once while dirty", async () => {
    show();
    fireEvent.change(await editor(), { target: { value: "Changed" } });
    expect(await screen.findAllByText("Save your changes first.")).toHaveLength(1);
  });

  it("confirms a delete and says the text stays as a draft", async () => {
    handlers["requests.posts.list"] = () => view([post({ status: "posted", sentCount: 2, partsCount: 2, postedAt: NOW, postedByName: "Ann" })]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Delete messages" }));
    expect(await screen.findByText(/Your text stays here as a draft/)).toBeTruthy();
  });

  it("keeps what is typed when the list refetches, and takes the server text when clean", async () => {
    const client = show();
    const area = await editor();
    fireEvent.change(area, { target: { value: "Typing on" } });
    handlers["requests.posts.list"] = () => view([post({ text: "Other", updatedAt: new Date(NOW.getTime() + 5000) })]);
    await act(() => client.invalidateQueries());
    expect((await editor()).value).toBe("Typing on");
    fireEvent.change(await editor(), { target: { value: "Other" } });
    handlers["requests.posts.list"] = () => view([post({ text: "From server", updatedAt: new Date(NOW.getTime() + 9000) })]);
    await act(() => client.invalidateQueries());
    expect((await editor()).value).toBe("From server");
  });

  it("inserts a placeholder chip at the caret", async () => {
    show();
    const area = await editor();
    fireEvent.change(area, { target: { value: "Hello world" } });
    area.setSelectionRange(5, 5);
    fireEvent.click(screen.getAllByRole("button", { name: "Insert event" })[1]);
    expect(area.value).toBe("Hello{event} world");
  });

  it("keeps the Discord preview closed until opened", async () => {
    show();
    await editor();
    expect(screen.queryByRole("group", { name: "Discord message preview" })).toBeNull();
    const triggers = await screen.findAllByRole("button", { name: /Discord preview/ });
    expect(triggers).toHaveLength(3);
    fireEvent.click(triggers[1]);
    expect(await screen.findByRole("group", { name: "Discord message preview" })).toBeTruthy();
  });

  it("lists a cancelled post as a read-only entry", async () => {
    handlers["requests.posts.list"] = () => view([post({ id: "c1", kind: "cancelled", status: "posted", note: "Venue closed", sentCount: 1, partsCount: 1, postedAt: NOW, postedByName: "Ann" })]);
    show();
    expect(await screen.findByRole("heading", { name: "Cancel message" })).toBeTruthy();
    expect(screen.getByText(/Venue closed/)).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });
});
