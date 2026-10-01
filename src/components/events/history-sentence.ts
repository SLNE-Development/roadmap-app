import { REQUEST_STATUSES, type RequestStatus } from "@/lib/event-status";
import type { RequestHistoryItem } from "@/lib/ops/requests";

/** A message key under `events.history` with its values, ready for the translator. */
export interface HistoryMessage {
  key: string;
  values: Record<string, string | number>;
}

/** The translator of the `events` namespace. */
export type EventsTranslator = (key: string, values?: Record<string, string | number>) => string;

const isStatus = (value: string | null): value is RequestStatus => REQUEST_STATUSES.includes(value as RequestStatus);

/** The request fields whose change reads "changed {field}"; each has a label in `history.field`. */
const FIELDS = ["title", "startsAt", "durationMinutes", "where", "summary", "banner", "eventDocsUrl", "requesterId"] as const;

const POST_KINDS = ["team", "announcement", "reminder", "disaster", "resolved", "cancelled"] as const;
const POST_ACTIONS: Record<string, string> = { "draft saved": "saved", "draft pasted": "pasted", sending: "sending", resumed: "resumed", edited: "edited", deleting: "deleting" };

/**
 * Describes one `request_log` row as a message key and values: every field the ops write has its own sentence; a value
 * that is not in the form the ops write falls back to a generic sentence.
 */
export function describeHistory(r: Pick<RequestHistoryItem, "field" | "oldValue" | "newValue">, status: (s: RequestStatus) => string): HistoryMessage {
  const { oldValue: from, newValue: to } = r;
  switch (r.field) {
    case "created":
      return { key: "created", values: {} };
    case "brief":
      return { key: "brief", values: { from: from ?? "", to: to ?? "" } };
    case "status":
      // A cancel logs its note as the new value.
      if (isStatus(from) && !isStatus(to)) return { key: "cancelled", values: { reason: to ?? "" } };
      return { key: "status", values: { from: isStatus(from) ? status(from) : (from ?? ""), to: isStatus(to) ? status(to) : (to ?? "") } };
    case "project":
      return { key: "project", values: { slug: to ?? "" } };
    case "post": {
      const m = /^(\w+) (draft saved|draft pasted|sending|resumed|edited|deleting)$/.exec(to ?? "");
      if (m && (POST_KINDS as readonly string[]).includes(m[1])) return { key: `post.${POST_ACTIONS[m[2]]}`, values: { kind: m[1] } };
      return { key: "other", values: {} };
    }
    case "fallback":
      return to === null ? { key: "fallbackRemoved", values: { title: from ?? "" } } : { key: "fallback", values: { title: to } };
    case "todo":
      if (to === "done" || to === "reopened") return { key: to === "done" ? "todoDone" : "todoReopened", values: { title: from ?? "" } };
      return to === null ? { key: "todoRemoved", values: { title: from ?? "" } } : { key: "todo", values: { title: to } };
    case "checklist": {
      const items = /^(\d+) items$/.exec(to ?? "");
      if (items) return { key: "checklistSet", values: { count: Number(items[1]) } };
      if (to === "done" || to === "reopened") return { key: to === "done" ? "checklistDone" : "checklistReopened", values: { label: from ?? "" } };
      return to === null ? { key: "checklistRemoved", values: { label: from ?? "" } } : { key: "checklistAdded", values: { label: to } };
    }
    case "questions": {
      const m = /^round (\d+) asked$/.exec(to ?? "");
      return m ? { key: "questions", values: { round: Number(m[1]) } } : { key: "other", values: {} };
    }
    case "answer": {
      const m = /^round (\d+), question (\d+): (answered|not sure)$/.exec(to ?? "");
      return m ? { key: m[3] === "answered" ? "answered" : "notSure", values: { round: Number(m[1]), question: Number(m[2]) } } : { key: "other", values: {} };
    }
    default:
      return (FIELDS as readonly string[]).includes(r.field) ? { key: "entry", values: { field: r.field } } : { key: "other", values: {} };
  }
}

/** Writes a history row as a sentence with the author's name and, when an agent acted for them, "via <agent>". */
export function historySentence(r: Pick<RequestHistoryItem, "field" | "oldValue" | "newValue" | "authorName" | "agent">, t: EventsTranslator): string {
  const m = describeHistory(r, (s) => t(`status.${s}`));
  const values: Record<string, string | number> = { ...m.values, name: r.authorName };
  if (typeof values.field === "string") values.field = t(`history.field.${values.field}`);
  if (typeof values.kind === "string") values.kind = t(`history.postKind.${values.kind}`);
  const sentence = t(`history.${m.key}`, values);
  return r.agent ? `${sentence} ${t("history.via", { agent: r.agent })}` : sentence;
}
