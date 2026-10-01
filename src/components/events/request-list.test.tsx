// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import type { RequestListItem } from "@/lib/ops/requests";
import en from "../../../messages/en";
import { RequestList } from "./request-list";

afterEach(cleanup);

let n = 0;
/** A list row with defaults; `over` replaces fields. */
function row(over: Partial<RequestListItem>): RequestListItem {
  n += 1;
  return {
    id: `r${n}`,
    title: `Request ${n}`,
    status: "draft",
    startsAt: new Date("2026-11-07T20:00:00Z"),
    endsAt: new Date("2026-11-07T22:00:00Z"),
    requesterId: "other",
    requesterName: "Rae Requester",
    projectSlug: null,
    briefVersion: 0,
    acceptedBy: null,
    submittedAt: null,
    waitingOnRequester: false,
    lateTodos: 0,
    needsActor: false,
    ...over,
  };
}

function view(rows: RequestListItem[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <RequestList rows={rows} userId="me" />
    </NextIntlClientProvider>,
  );
}

/** The panel with the given heading. */
const section = (name: string) => screen.getByRole("heading", { name }).closest("section")!;

describe("RequestList", () => {
  const rows = [
    row({ title: "Waiting one", status: "submitted", needsActor: true }),
    row({ title: "Summer party", status: "accepted" }),
    row({ title: "Idea", status: "draft", startsAt: null, endsAt: null }),
    row({ title: "Old gig", status: "done" }),
  ];

  it("puts rows into their sections", () => {
    view(rows);
    expect(within(section("Needs you")).getByText("Waiting one")).toBeTruthy();
    expect(within(section("Upcoming")).getByText("Summer party")).toBeTruthy();
    expect(within(section("Drafts and submitted")).getByText("Idea")).toBeTruthy();
    expect(within(section("Drafts and submitted")).getByText("No date")).toBeTruthy();
    expect(within(section("Upcoming")).getByText("20:00-22:00")).toBeTruthy();
  });

  it("keeps the past section closed by default", () => {
    view(rows);
    expect(screen.queryByText("Old gig")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show past requests" }));
    expect(screen.getByText("Old gig")).toBeTruthy();
  });

  it("filters by title", () => {
    view(rows);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search requests by title" }), { target: { value: "summer" } });
    expect(screen.getByText("Summer party")).toBeTruthy();
    expect(screen.queryByText("Idea")).toBeNull();
    expect(screen.queryByText("Waiting one")).toBeNull();
  });

  it("narrows to my requests with Mine", () => {
    view([row({ title: "My own", requesterId: "me" }), row({ title: "Accepted by me", status: "accepted", acceptedBy: "me" }), row({ title: "Theirs" })]);
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByText("My own")).toBeTruthy();
    expect(screen.getByText("Accepted by me")).toBeTruthy();
    expect(screen.queryByText("Theirs")).toBeNull();
  });

  it("shows an empty state when nothing exists", () => {
    view([]);
    expect(screen.getByText("No requests")).toBeTruthy();
    expect(screen.getByText("Requests you file or follow appear here.")).toBeTruthy();
  });
});
