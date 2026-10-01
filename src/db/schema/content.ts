import { bigserial, boolean, index, integer, pgTable, primaryKey, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";
import { board, boardColumn, domain, phase, project } from "./projects";

/** Priority classes, from most to least urgent. */
export const PRIORITIES = ["MVP", "Later", "Nice to have"] as const;

/** The priority class of a system or task. */
export type Priority = (typeof PRIORITIES)[number];

/** States of a task, in checklist order. */
export const TASK_STATES = ["todo", "doing", "blocked", "done"] as const;

/** The state of a task. */
export type TaskState = (typeof TASK_STATES)[number];

/** Task estimates, from smallest to largest. */
export const TASK_ESTIMATES = ["S", "M", "L"] as const;

/** The estimate of a task. */
export type TaskEstimate = (typeof TASK_ESTIMATES)[number];

/** Kinds of versioned system documents. */
export const DOCUMENT_KINDS = ["spec", "plan"] as const;

/** The kind of a system document. */
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Lifecycle states of an ADR. */
export const ADR_STATUSES = ["proposed", "accepted", "superseded"] as const;

/** The lifecycle state of an ADR. */
export type AdrStatus = (typeof ADR_STATUSES)[number];

/** Units of work tracked on a board: a feature, subsystem or build, with its planning state. */
export const system = pgTable(
  "system",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => board.id),
    columnId: text("column_id")
      .notNull()
      .references(() => boardColumn.id),
    domainId: text("domain_id").references(() => domain.id, { onDelete: "set null" }),
    phaseId: text("phase_id").references(() => phase.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("Later"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull(),
    planningCompletedAt: timestamp("planning_completed_at", tz),
    planningConfirmation: text("planning_confirmation"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("system_project_slug").on(t.projectId, t.slug),
    index("system_board_id_idx").on(t.boardId),
    index("system_column_id_idx").on(t.columnId),
    index("system_owner_user_id_idx").on(t.ownerUserId),
  ],
);

/** Checklist items of a system; `planStep` links a task to a step of the system's plan. */
export const task = pgTable(
  "task",
  {
    id: serial("id").primaryKey(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    state: text("state", { enum: TASK_STATES }).notNull().default("todo"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("Later"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes").notNull().default(""),
    blockedReason: text("blocked_reason"),
    estimate: text("estimate", { enum: TASK_ESTIMATES }),
    planStep: integer("plan_step"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [
    unique("task_system_plan_step").on(t.systemId, t.planStep),
    index("task_system_id_idx").on(t.systemId, t.sortOrder),
    index("task_owner_user_id_idx").on(t.ownerUserId),
  ],
);

/** Checklist items inside a task. */
export const taskCheck = pgTable(
  "task_check",
  {
    id: text("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("task_check_task_id_idx").on(t.taskId, t.sortOrder)],
);

/** Append-only versions of a system's spec and plan. */
export const systemDocument = pgTable(
  "system_document",
  {
    id: text("id").primaryKey(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [unique("system_document_version").on(t.systemId, t.kind, t.version)],
);

/** Architecture decision records, numbered per project and immutable once accepted. */
export const adr = pgTable(
  "adr",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ADR_STATUSES }).notNull().default("proposed"),
    context: text("context").notNull(),
    decision: text("decision").notNull(),
    alternatives: text("alternatives").notNull(),
    consequences: text("consequences").notNull(),
    supersedesId: text("supersedes_id"),
    supersededById: text("superseded_by_id"),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", tz),
  },
  (t) => [unique("adr_project_number").on(t.projectId, t.number)],
);

/** Links between ADRs and the systems they concern. */
export const adrSystem = pgTable(
  "adr_system",
  {
    adrId: text("adr_id")
      .notNull()
      .references(() => adr.id, { onDelete: "cascade" }),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.adrId, t.systemId] }), index("adr_system_system_id_idx").on(t.systemId)],
);

/** Open questions of a project, optionally tied to a system, with their answer and who gave it. */
export const question = pgTable(
  "question",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    systemId: text("system_id").references(() => system.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    text: text("text").notNull().default(""),
    answer: text("answer"),
    resolved: boolean("resolved").notNull().default(false),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", tz),
    answeredByUserId: text("answered_by_user_id").references(() => user.id, { onDelete: "set null" }),
    answeredAgent: text("answered_agent"),
    answeredAt: timestamp("answered_at", tz),
  },
  (t) => [index("question_project_id_idx").on(t.projectId, t.resolved), index("question_system_id_idx").on(t.systemId)],
);

/** Progress reports by people or agents about their work on a system. */
export const progressUpdate = pgTable(
  "progress_update",
  {
    id: text("id").primaryKey(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => task.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    nextStep: text("next_step"),
    commitHash: text("commit_hash"),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("progress_update_system_id_idx").on(t.systemId, t.createdAt)],
);

/** Append-only record of every change; `systemId` groups entries for a system's history. */
export const changeLog = pgTable(
  "change_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    systemId: text("system_id").references(() => system.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    agent: text("agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("change_log_project_id_idx").on(t.projectId, t.id), index("change_log_system_id_idx").on(t.systemId)],
);
