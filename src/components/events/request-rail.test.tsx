// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestStatus } from "@/lib/event-status";
import type { RequestDetail } from "@/lib/ops/requests";
import { fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { RequestRail } = await import("./request-rail");

afterEach(cleanup);
beforeEach(() => {
  resetTRPC();
  handlers["requests.rounds"] = () => [];
  handlers["requests.fallbacks"] = () => [];
  handlers["requests.todos"] = () => [{ id: "t1", title: "Book DJ", dueAt: new Date("2026-10-01T09:00:00Z"), doneAt: null, late: true, ownerName: null }];
  handlers["requests.posts.list"] = () => ({ posts: [{ kind: "announcement", status: "posted", late: false }], targets: {}, pingRoleSet: false, dues: {} });
  handlers["requests.progress"] = () => null;
  handlers["requests.history"] = () => [{ id: 1, field: "post", oldValue: null, newValue: "announcement draft saved", createdAt: new Date("2026-10-01T09:00:00Z"), authorName: "Ammo", author: "Ammo", agent: null }];
});

/** Renders the rail of a request in `status` whose Discord event does not exist. */
async function rail(status: RequestStatus) {
  const detail = { request: { id: "r1", status, eventDocsUrl: null }, canEdit: true, canManage: true, canDevelop: false, discordEvent: { url: null, reason: "not-yet" } } as unknown as RequestDetail;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <Suspense fallback={null}>
          <RequestRail detail={detail} />
        </Suspense>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "History" });
}

describe("RequestRail", () => {
  it("writes history rows as sentences", async () => {
    await rail("accepted");
    expect(screen.getByText("Ammo saved the announcement draft")).toBeTruthy();
  });

  it("shows to-dos and the event hint while the event is live", async () => {
    await rail("accepted");
    expect(screen.getByText("Book DJ")).toBeTruthy();
    expect(screen.getByText(/No Discord event yet/)).toBeTruthy();
  });

  it.each(["done", "cancelled"] as const)("shows no to-dos, late flags or event hint for a %s request", async (status) => {
    await rail(status);
    expect(screen.queryByText("Next to-dos")).toBeNull();
    expect(screen.queryByText("Late")).toBeNull();
    expect(screen.queryByText(/No Discord event yet/)).toBeNull();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.getByText("Announcement")).toBeTruthy();
  });
});
