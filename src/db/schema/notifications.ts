import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";
import { NOTIFICATION_KINDS } from "@/lib/notification-kinds";
import { project } from "./projects";

export { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notification-kinds";

/** Where a notification's push delivery stands. */
export const PUSH_STATUSES = ["pending", "sent", "skipped", "failed"] as const;

/**
 * One notice for one user about something in a project: their inbox entry and its push state.
 * Never logged in `change_log`.
 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    /** The recipient. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
    /** What it points at, such as `question` and its id. */
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    /** Plain text: the title at most 80 characters, the body at most 140. */
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** An app-relative path starting with `/p/`. */
    href: text("href").notNull(),
    /** Who caused it, such as "Claude Code for Ammo"; null when no one did. */
    actorName: text("actor_name"),
    /** What created it, such as `cl:<change id>`; each source notifies a user once. */
    sourceKey: text("source_key").notNull(),
    /** Whether it shows in the inbox; rows kept only for push are created read. */
    inInbox: boolean("in_inbox").notNull().default(true),
    pushStatus: text("push_status", { enum: PUSH_STATUSES }).notNull().default("pending"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    /** When the recipient read it; null while unread. */
    readAt: timestamp("read_at", tz),
  },
  (t) => [
    unique("notification_source_unique").on(t.userId, t.sourceKey),
    index("notification_user_created").on(t.userId, t.createdAt.desc()),
    index("notification_push_created").on(t.pushStatus, t.createdAt),
  ],
);

/** A row of {@link notification}. */
export type NotificationRow = typeof notification.$inferSelect;
