import { bigserial, type AnyPgColumn, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { QUESTION_TYPES, type QuestionConfig, type QuestionType } from "@/lib/event-questions";
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
    bannerUploadId: text("banner_upload_id").references((): AnyPgColumn => eventUpload.id, { onDelete: "set null" }),
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

/** What an uploaded image is used for. */
export const UPLOAD_PURPOSES = ["banner", "embed", "fallback", "template"] as const;

/** One of {@link UPLOAD_PURPOSES}. */
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * An uploaded image. The bytes live on the uploads volume under `storageKey`; the row decides who may read them.
 * `requestId` is null for settings images (the disaster, resolved and details templates).
 */
export const eventUpload = pgTable(
  "event_upload",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").references(() => eventRequest.id, { onDelete: "cascade" }),
    uploaderId: text("uploader_id").references(() => user.id, { onDelete: "set null" }),
    purpose: text("purpose", { enum: UPLOAD_PURPOSES }).notNull(),
    /** The file name as shown, stripped of path separators and control characters. */
    originalName: text("original_name").notNull(),
    /** The type sniffed from the bytes, never the declared one. */
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    /** `<id>.<ext>`, generated by the server. */
    storageKey: text("storage_key").notNull().unique(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("event_upload_request").on(t.requestId)],
);

/** A row of {@link eventUpload}. */
export type EventUploadRow = typeof eventUpload.$inferSelect;

/** A round of questions a developer asked on a request; `number` counts up from 1 per request. */
export const eventQuestionRound = pgTable(
  "event_question_round",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => eventRequest.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    askedBy: text("asked_by").references(() => user.id, { onDelete: "set null" }),
    /** The agent that asked for the author, if any. */
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [unique("event_question_round_number").on(t.requestId, t.number)],
);

/** One question of a round, with its answer once given. `answer` holds the typed value (see `answerValueSchema`); a "not sure" answer has `notSure` and no value. */
export const eventQuestion = pgTable(
  "event_question",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id")
      .notNull()
      .references(() => eventQuestionRound.id, { onDelete: "cascade" }),
    /** Denormalised from the round for queries. */
    requestId: text("request_id")
      .notNull()
      .references(() => eventRequest.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type", { enum: QUESTION_TYPES }).notNull().$type<QuestionType>(),
    text: text("text").notNull(),
    why: text("why"),
    required: boolean("required").notNull().default(true),
    config: jsonb("config").notNull().$type<QuestionConfig>(),
    suggested: jsonb("suggested"),
    answer: jsonb("answer"),
    notSure: boolean("not_sure").notNull().default(false),
    answeredBy: text("answered_by").references(() => user.id, { onDelete: "set null" }),
    answeredAt: timestamp("answered_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("event_question_request_answered").on(t.requestId, t.answeredAt)],
);

/** A row of {@link eventQuestion}. */
export type EventQuestionRow = typeof eventQuestion.$inferSelect;

/** Which brief version a system's spec version was written against, so the project can tell when the brief moved on. */
export const eventSpecBasis = pgTable(
  "event_spec_basis",
  {
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    specVersion: integer("spec_version").notNull(),
    briefVersion: integer("brief_version").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.systemId, t.specVersion] })],
);
