/**
 * What a notification is about.
 *
 * A new kind also touches: `PUSH_BY_DEFAULT` in src/lib/notify-rules-schema.ts (whether it pushes by default;
 * `DEFAULT_NOTIFY_RULES`, re-exported from src/lib/ops/notifications.ts, follows), `KIND_LABELS` in
 * src/components/notifications/rules-table.tsx (its settings row), and the code that creates it: a rule in
 * `RULES` of src/worker/consumers/notifications.ts that maps a change-log entry to it (plus `SELF_AGENT_KINDS`
 * there if the author's own agent needs it), or a direct `notify` call. Push urgency is set in
 * src/worker/jobs/push.ts.
 */
export const NOTIFICATION_KINDS = [
  "mention",
  "question.answered",
  "question.asked",
  "planning.round",
  "system.assigned",
  "task.assigned",
  "task.blocked",
  "system.blocked",
  "system.done",
  "adr.proposed",
  "update.posted",
  "pr.merged",
  "checks.failed",
  "automation.blocked",
  "request.submitted",
  "request.question",
  "request.answered",
  "request.brief_changed",
  "request.waiting",
  "request.pickup",
  "request.todo_due",
  "request.accepted",
] as const;

/** A kind of notification. */
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
