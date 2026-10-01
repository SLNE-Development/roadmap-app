/** What a notification is about. */
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
] as const;

/** A kind of notification. */
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
