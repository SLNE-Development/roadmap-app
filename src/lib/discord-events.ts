/** What a project's Discord webhook can be told about. */
export const DISCORD_EVENTS = [
  "system.done",
  "system.blocked",
  "system.moved",
  "planning.completed",
  "adr.proposed",
  "adr.accepted",
  "question.asked",
  "question.answered",
  "update.posted",
  "task.changed",
] as const;

/** An event a Discord webhook can subscribe to. */
export type DiscordEvent = (typeof DISCORD_EVENTS)[number];

/** The events a new webhook subscribes to: all but the noisy `system.moved` and `task.changed`. */
export const DEFAULT_DISCORD_EVENTS: readonly DiscordEvent[] = DISCORD_EVENTS.filter((e) => e !== "system.moved" && e !== "task.changed");

