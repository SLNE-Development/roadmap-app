import { bigserial, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";

/** What happened in an {@link authEvent}. */
export const AUTH_EVENT_KINDS = [
  "sign-in",
  "sign-in-refused",
  "session-ended",
  "key-created",
  "key-revoked",
  "key-rotated",
  "key-rejected",
  "key-rate-limited",
] as const;

/** A kind of {@link authEvent}. */
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];

/**
 * One sign-in, session or API key event for the admin audit view.
 * Telemetry, so never logged in `change_log`; never holds a key itself.
 */
export const authEvent = pgTable(
  "auth_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", tz).notNull().defaultNow(),
    kind: text("kind", { enum: AUTH_EVENT_KINDS }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    discordId: text("discord_id"),
    /** The key involved; no foreign key, since events outlive revoked keys. */
    apiKeyId: text("api_key_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    detail: text("detail"),
  },
  (t) => [index("auth_event_at").on(t.at.desc()), index("auth_event_user_at").on(t.userId, t.at.desc())],
);

/** A row of {@link authEvent}. */
export type AuthEventRow = typeof authEvent.$inferSelect;
