import { bigserial, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { REQUEST_STATUSES } from "@/lib/event-status";
import { tz, user } from "./auth";
import { project } from "./projects";
import { system } from "./content";

/**
 * An event request: filed by a requester outside any project, accepted by a
 * developer, and linked to at most one project and one system. History goes to
 * {@link requestLog}, not `change_log`, because requests have no project.
 */
export const eventRequest = pgTable(
  "event_request",
  {
    id: text("id").primaryKey(),
    /** The requester; a removed user leaves the request visible to managers. */
    requesterId: text("requester_id").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("draft"),
    /** When the event starts and how long it lasts, if the requester knows yet. */
    startsAt: timestamp("starts_at", tz),
    durationMinutes: integer("duration_minutes"),
    /** Where the event takes place: a world, server or area. */
    where: text("where").notNull().default(""),
    eventDocsUrl: text("event_docs_url"),
    /** The current version number of the brief (see {@link eventBriefVersion}). */
    briefVersion: integer("brief_version").notNull().default(1),
    /** The project and system built for the request; several requests may share a project. */
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    systemId: text("system_id").references(() => system.id, { onDelete: "set null" }),
    /** The scheduled Discord event and the uploaded banner, filled by later features. */
    discordEventId: text("discord_event_id"),
    bannerUploadId: text("banner_upload_id"),
    /** When the request was submitted and accepted, and by whom. */
    submittedAt: timestamp("submitted_at", tz),
    acceptedAt: timestamp("accepted_at", tz),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("event_request_requester_status").on(t.requesterId, t.status),
    index("event_request_status_starts").on(t.status, t.startsAt),
    index("event_request_project").on(t.projectId),
  ],
);

/** A row of {@link eventRequest}. */
export type EventRequestRow = typeof eventRequest.$inferSelect;

/** One version of a request's brief; the number counts up from 1 and old versions are kept. */
export const eventBriefVersion = pgTable(
  "event_brief_version",
  {
    requestId: text("request_id")
      .notNull()
      .references(() => eventRequest.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.version] })],
);

/**
 * The history of one request: one row per changed field. `field` is `created`,
 * `status`, `title`, `startsAt`, `durationMinutes`, `where`, `eventDocsUrl`,
 * `brief`, `project`, `fallback`, `todo`, `post`, `settings` and so on. Never
 * holds secrets or webhook URLs.
 */
export const requestLog = pgTable(
  "request_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => eventRequest.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The agent that acted for the author, if any. */
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("request_log_request_id").on(t.requestId, t.id)],
);
