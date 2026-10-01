import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";

/** Roles a member can have in a project, from most to least privileged. */
export const PROJECT_ROLES = ["owner", "editor", "viewer"] as const;

/** A member's role in a project. */
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** What a board column means, independent of its name. */
export const COLUMN_CATEGORIES = ["planning", "todo", "active", "review", "blocked", "done"] as const;

/** The meaning of a board column. */
export type ColumnCategory = (typeof COLUMN_CATEGORIES)[number];

/** Top-level containers; everything else belongs to exactly one project. */
export const project = pgTable("project", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  repoUrl: text("repo_url"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  /** When an owner archived the project (hidden, read-only); null while active. */
  archivedAt: timestamp("archived_at", tz),
});

/** Membership of a user in a project, with their role and when they joined. */
export const projectMember = pgTable(
  "project_member",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: PROJECT_ROLES }).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_member_user_id_idx").on(t.userId)],
);

/** Workstreams of a project, each with its own columns and systems. */
export const board = pgTable(
  "board",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    /** Fields cards show, in order: built-in names or `custom:<key>`. */
    cardFields: jsonb("card_fields").$type<string[]>().notNull().default(sql`'["domain","priority","blocked","tasks","owner"]'::jsonb`),
  },
  (t) => [unique("board_project_slug").on(t.projectId, t.slug)],
);

/** Ordered columns of a board; the category gives each column its meaning. */
export const boardColumn = pgTable(
  "board_column",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => board.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category", { enum: COLUMN_CATEGORIES }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("board_column_board_id_idx").on(t.boardId)],
);

/** Areas that group systems within a project, such as Police or Vehicles. */
export const domain = pgTable(
  "domain",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("domain_project_id_idx").on(t.projectId, t.sortOrder)],
);

/** Delivery phases of a project, in order. */
export const phase = pgTable(
  "phase",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("phase_project_id_idx").on(t.projectId, t.sortOrder)],
);

/** Edges stating that one phase builds on another phase of the same project. */
export const phaseDependency = pgTable(
  "phase_dependency",
  {
    phaseId: text("phase_id")
      .notNull()
      .references(() => phase.id, { onDelete: "cascade" }),
    dependsOnId: text("depends_on_id")
      .notNull()
      .references(() => phase.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.phaseId, t.dependsOnId] }), index("phase_dependency_depends_on_id_idx").on(t.dependsOnId)],
);

/** Value types of a custom field. */
export const FIELD_TYPES = ["text", "select", "number", "date"] as const;

/** The value type of a custom field. */
export type FieldType = (typeof FIELD_TYPES)[number];

/** Per-project fields that every system of the project can carry a value for. */
export const customField = pgTable(
  "custom_field",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: FIELD_TYPES }).notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [unique("custom_field_project_key").on(t.projectId, t.key)],
);

/** A user's saved, pinnable view: a page path plus its filter query. Personal, so never logged in `change_log`. */
export const savedView = pgTable(
  "saved_view",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The project the view belongs to; null for a global page such as the workload. */
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    /** The URL query without the leading `?`. */
    query: text("query").notNull().default(""),
    pinned: boolean("pinned").notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("saved_view_user_sort_idx").on(t.userId, t.sortOrder)],
);
