import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";
import { NOTIFICATION_KINDS } from "@/lib/notification-kinds";
import { project } from "./projects";

export { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notification-kinds";
export { DISCORD_EVENTS, type DiscordEvent } from "@/lib/discord-events";

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

/** A Discord webhook a project owner set up to post the project's changes into a channel. */
export const projectWebhook = pgTable("project_webhook", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  /** What the owner calls it, such as "#roadmap-surf". */
  name: text("name").notNull(),
  /** The webhook URL, encrypted with `encryptSecret`; never sent to the browser or logged. */
  urlEnc: text("url_enc").notNull(),
  /** The last 4 characters of the webhook token, shown as `…/••••abcd`. */
  urlHint: text("url_hint").notNull(),
  /** The `DISCORD_EVENTS` it posts. */
  events: text("events").array().notNull(),
  /** The boards whose systems it posts about; empty means all boards. */
  boardIds: text("board_ids").array().notNull().default(sql`'{}'`),
  /** Whether it also gets the weekly digest on Mondays at 09:00 in `timeZone`. */
  digest: boolean("digest").notNull().default(false),
  timeZone: text("time_zone").notNull().default("UTC"),
  enabled: boolean("enabled").notNull().default(true),
  /** Why delivery turned it off, such as Discord no longer accepting it; null otherwise. */
  disabledReason: text("disabled_reason"),
  lastSentAt: timestamp("last_sent_at", tz),
  lastDigestAt: timestamp("last_digest_at", tz),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
});

/** A row of {@link projectWebhook}. */
export type ProjectWebhookRow = typeof projectWebhook.$inferSelect;

/** One change waiting to be posted to a webhook; each change is queued once per webhook. */
export const discordOutbox = pgTable(
  "discord_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => projectWebhook.id, { onDelete: "cascade" }),
    changeLogId: bigint("change_log_id", { mode: "number" }).notNull(),
    /** The `DiscordItem` to post. */
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    /** When it was posted; null while pending. */
    sentAt: timestamp("sent_at", tz),
  },
  (t) => [unique("discord_outbox_unique").on(t.webhookId, t.changeLogId), index("discord_outbox_webhook_sent").on(t.webhookId, t.sentAt)],
);
