import { boolean, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";
import { system } from "./content";

/** Areas a planning interview must cover before a system may leave planning. */
export const PLANNING_AREAS = ["failure-modes", "dependencies", "scope", "ops-testing"] as const;

/** An area of a planning interview. */
export type PlanningArea = (typeof PLANNING_AREAS)[number];

/** States of a planning question. */
export const PLANNING_ITEM_STATUSES = ["open", "answered", "accepted-risk"] as const;

/** The state of a planning question. */
export type PlanningItemStatus = (typeof PLANNING_ITEM_STATUSES)[number];

/** Numbered rounds of a system's planning interview. */
export const planningRound = pgTable(
  "planning_round",
  {
    id: text("id").primaryKey(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [unique("planning_round_number").on(t.systemId, t.number)],
);

/** Questions of a planning round with their area, risk flag, answer and state. */
export const planningItem = pgTable("planning_item", {
  id: text("id").primaryKey(),
  roundId: text("round_id")
    .notNull()
    .references(() => planningRound.id, { onDelete: "cascade" }),
  area: text("area", { enum: PLANNING_AREAS }).notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  isRisk: boolean("is_risk").notNull().default(false),
  status: text("status", { enum: PLANNING_ITEM_STATUSES }).notNull().default("open"),
  sortOrder: integer("sort_order").notNull(),
});
