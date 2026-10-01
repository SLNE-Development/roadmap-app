import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { tz, user } from "./auth";

/** A user's own settings as key/value pairs, such as which overview panels are open. Personal, so never logged in `change_log`. */
export const userPref = pgTable(
  "user_pref",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** How far each change-feed consumer has read in `change_log`; one row per consumer name. */
export const feedCursor = pgTable("feed_cursor", {
  name: text("name").primaryKey(),
  lastId: bigint("last_id", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** Change ids already delivered to a consumer, so late lower ids are delivered once; pruned after 15 minutes. */
export const feedSeen = pgTable(
  "feed_seen",
  {
    consumer: text("consumer").notNull(),
    changeId: bigint("change_id", { mode: "number" }).notNull(),
    seenAt: timestamp("seen_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.changeId] }), index("feed_seen_seen_at").on(t.seenAt)],
);
