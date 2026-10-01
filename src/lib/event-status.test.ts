import { describe, expect, it } from "vitest";
import { canTransition, isOpen, REQUEST_STATUSES, type RequestStatus } from "./event-status";

/** The only allowed edges. */
const EDGES: [RequestStatus, RequestStatus][] = [
  ["draft", "submitted"],
  ["draft", "withdrawn"],
  ["submitted", "accepted"],
  ["submitted", "withdrawn"],
  ["submitted", "draft"],
  ["accepted", "event_week"],
  ["accepted", "cancelled"],
  ["event_week", "done"],
  ["event_week", "cancelled"],
];

describe("canTransition", () => {
  it.each(EDGES)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("allows exactly the nine edges in the 7x7 matrix", () => {
    const allowed = REQUEST_STATUSES.flatMap((from) => REQUEST_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`));
    expect(allowed.sort()).toEqual(EDGES.map(([from, to]) => `${from}>${to}`).sort());
    expect(allowed).toHaveLength(9);
  });
});

describe("isOpen", () => {
  it("is true for draft, submitted, accepted and event_week only", () => {
    expect(REQUEST_STATUSES.filter(isOpen)).toEqual(["draft", "submitted", "accepted", "event_week"]);
  });
});
