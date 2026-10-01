// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RequestDetail } from "@/lib/ops/requests";
import { calls, fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { RequestOverview } = await import("./request-overview");

afterEach(cleanup);
beforeEach(() => {
  resetTRPC();
  handlers["requests.rounds"] = () => [];
  handlers["requests.fallbacks"] = () => [];
  handlers["requests.todos"] = () => [];
  handlers["requests.posts.list"] = () => ({ posts: [], targets: { team: false, public: false, staff: false }, pingRoleSet: false, dues: {} });
  handlers["requests.progress"] = () => null;
  handlers["requests.history"] = () => [];
  handlers["requests.update"] = () => ({});
});

/** A request detail for an editor; `updatedAt` stands for the refetch that brought it. */
function detail(updatedAt: number): RequestDetail {
  return {
    request: {
      id: "r1",
      title: "Summer party",
      status: "accepted",
      summary: "A party.",
      startsAt: new Date("2026-11-07T20:00:00Z"),
      endsAt: new Date("2026-11-07T22:00:00Z"),
      where: "Main hall",
      eventDocsUrl: "https://example.com/docs",
      bannerUploadId: null,
      updatedAt: new Date(updatedAt),
    },
    canEdit: true,
    canManage: false,
    canDevelop: false,
    discordEvent: { url: null, reason: "not-yet" },
  } as unknown as RequestDetail;
}

/** The tree with the given detail inside providers that stay the same across renders. */
const tree = (d: RequestDetail, client: QueryClient) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TooltipProvider>
        <Suspense fallback={null}>
          <RequestOverview detail={d} />
        </Suspense>
      </TooltipProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>
);

describe("RequestOverview details", () => {
  it("sends the end the person typed", async () => {
    render(tree(detail(1), new QueryClient()));
    const end = (await screen.findByLabelText("End")) as HTMLInputElement;
    expect(end.value).toBe("2026-11-07T22:00");
    fireEvent.change(end, { target: { value: "2026-11-07T23:30" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(calls["requests.update"]).toEqual([{ id: "r1", endsAt: new Date("2026-11-07T23:30:00Z") }]));
  });

  it("refuses an end before the start", async () => {
    render(tree(detail(1), new QueryClient()));
    fireEvent.change(await screen.findByLabelText("End"), { target: { value: "2026-11-07T19:00" } });
    expect(screen.getByText("The end must be after the start.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a dirty card when the request is refetched", async () => {
    const client = new QueryClient();
    const view = render(tree(detail(1), client));
    const where = (await screen.findByLabelText("Where")) as HTMLInputElement;
    fireEvent.change(where, { target: { value: "Garden" } });
    view.rerender(tree(detail(2), client));
    expect((screen.getByLabelText("Where") as HTMLInputElement).value).toBe("Garden");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("keeps text typed while a save runs unsaved", async () => {
    let finish: () => void = () => {};
    handlers["requests.update"] = () => new Promise((resolve) => (finish = () => resolve({})));
    render(tree(detail(1), new QueryClient()));
    const where = (await screen.findByLabelText("Where")) as HTMLInputElement;
    fireEvent.change(where, { target: { value: "Garden" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(calls["requests.update"]).toHaveLength(1));
    fireEvent.change(where, { target: { value: "Garden, north gate" } });
    finish();
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeTruthy());
    expect(where.value).toBe("Garden, north gate");
  });
});
