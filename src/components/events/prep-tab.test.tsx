// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TodoView } from "@/lib/ops/request-prep";
import { fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { PrepTab, groupTodos } = await import("./prep-tab");

afterEach(cleanup);

const NOW = new Date();
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** A to-do due `days` from NOW. */
const todo = (id: string, days: number, over: Partial<TodoView> = {}): TodoView =>
  ({ id, title: id, templateKey: null, ownerUserId: null, ownerName: null, dueAt: day(days), doneAt: null, late: days < 0, ...over }) as TodoView;

describe("groupTodos", () => {
  it("groups by due date and keeps done to-dos apart", () => {
    const groups = groupTodos([todo("later", 20), todo("week-b", 5), todo("late", -2), todo("week-a", 1), todo("done", -9, { doneAt: day(-8), late: false })], NOW);
    expect(groups.late.map((x) => x.id)).toEqual(["late"]);
    expect(groups.week.map((x) => x.id)).toEqual(["week-a", "week-b"]);
    expect(groups.later.map((x) => x.id)).toEqual(["later"]);
    expect(groups.done.map((x) => x.id)).toEqual(["done"]);
  });
});

describe("PrepTab", () => {
  beforeEach(() => {
    resetTRPC();
    handlers["requests.todos"] = () => [todo("Book the hall", -1), todo("Send invites", 3), todo("Tidy up", -9, { doneAt: day(-8), late: false })];
    handlers["requests.owners"] = () => [];
  });

  it("shows the groups, with the done group collapsed", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <TooltipProvider>
            <Suspense fallback={null}>
              <PrepTab requestId="r1" canEdit />
            </Suspense>
          </TooltipProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Late" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "This week" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Later" })).toBeNull();
    const done = screen.getByRole("heading", { name: "Done" }).closest("details") as HTMLDetailsElement;
    expect(done.open).toBe(false);
  });
});
