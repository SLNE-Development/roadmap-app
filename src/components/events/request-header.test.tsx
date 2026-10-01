// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RequestStatus } from "@/lib/event-status";
import type { RequestDetail } from "@/lib/ops/requests";
import { calls, fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

// The menu content renders in a portal; these stand-ins render it inline.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Box,
    DropdownMenuContent: Box,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: Box,
    DropdownMenuItem: ({ children, onSelect, disabled, asChild }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean; asChild?: boolean }) =>
      asChild ? <>{children}</> : (
        <button type="button" disabled={disabled} onClick={onSelect}>
          {children}
        </button>
      ),
  };
});
vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { RequestHeader } = await import("./request-header");

afterEach(cleanup);
beforeEach(() => {
  resetTRPC();
  handlers["requests.history"] = () => [];
  handlers["requests.cancelPreview"] = () => ({ willPost: false, reason: "not-posted", embed: null });
  handlers["requests.settings.get"] = () => ({ postAs: "Events", timeZone: "UTC" });
  handlers["requests.markDone"] = () => ({});
});

/** A request detail in `status` with the rights of a requester who may edit; `over` replaces fields. */
function detail(status: RequestStatus, over: Partial<RequestDetail> = {}): RequestDetail {
  return {
    request: {
      id: "r1",
      title: "Summer party",
      status,
      startsAt: new Date("2026-11-07T20:00:00Z"),
      endsAt: new Date("2026-11-07T22:00:00Z"),
      where: "Main hall",
      projectId: null,
      acceptedAt: null,
      cancelNote: null,
    },
    requesterName: "Rae Requester",
    projectSlug: null,
    brief: "",
    canEdit: true,
    canManage: false,
    canCancel: false,
    canReopen: false,
    canDelete: false,
    canAccept: false,
    canDevelop: false,
    projectOpen: false,
    role: "requester",
    discordEvent: { url: null, reason: "not-yet" },
    ...over,
  } as unknown as RequestDetail;
}

/** Renders the header of `d` and waits for the stepper. */
async function view(d: RequestDetail, incomplete: string[] = []) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <TooltipProvider>
          <Suspense fallback={null}>
            <RequestHeader detail={d} incomplete={incomplete} tab="overview" />
          </Suspense>
        </TooltipProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Summer party" });
}

describe("RequestHeader primary action", () => {
  it.each([
    ["draft", {}, "Submit"],
    ["submitted", { canAccept: true, canDevelop: true }, "Accept request"],
    ["accepted", {}, "Start event week"],
    ["event_week", {}, "Complete event"],
    ["cancelled", { canReopen: true, canEdit: false, canManage: true }, "Reopen"],
  ] as const)("shows the next step of a %s request", async (status, rights, label) => {
    await view(detail(status, rights));
    expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
  });

  it("offers no primary step to a viewer", async () => {
    await view(detail("draft", { canEdit: false }));
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByText("View only")).toBeTruthy();
  });

  it("disables Start event week while the fallback is incomplete", async () => {
    await view(detail("accepted"), ["Power outage"]);
    expect((screen.getByRole("button", { name: "Start event week" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("RequestHeader dialogs", () => {
  it("asks before completing the event and only then mutates", async () => {
    await view(detail("event_week"));
    fireEvent.click(screen.getByRole("button", { name: "Complete event" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(calls["requests.markDone"]).toBeUndefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Complete event" }));
    await waitFor(() => expect(calls["requests.markDone"]).toEqual([{ id: "r1" }]));
  });

  it("needs a reason to cancel and says when no message is sent", async () => {
    await view(detail("accepted", { canCancel: true }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel event" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("No cancel message is sent, because the announcement was not posted.")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Cancel event" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Venue closed" } });
    expect(confirm.disabled).toBe(false);
  });
});
