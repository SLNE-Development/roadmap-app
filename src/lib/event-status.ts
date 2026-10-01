/** Every status an event request can have, in the order of its life. */
export const REQUEST_STATUSES = ["draft", "submitted", "accepted", "event_week", "done", "withdrawn", "cancelled"] as const;

/** A status of an event request. */
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** The statuses a request can move to from each status; the single source of the lifecycle. */
const EDGES: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["accepted", "withdrawn", "draft"],
  accepted: ["event_week", "cancelled"],
  event_week: ["done", "cancelled"],
  done: [],
  withdrawn: [],
  cancelled: [],
};

/** Returns whether a request may move from `from` to `to`; `submitted` to `draft` is the requester's recall. */
export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return EDGES[from].includes(to);
}

/** Returns whether a request in `status` is still in progress (not done, withdrawn or cancelled). */
export function isOpen(status: RequestStatus): boolean {
  return status === "draft" || status === "submitted" || status === "accepted" || status === "event_week";
}
