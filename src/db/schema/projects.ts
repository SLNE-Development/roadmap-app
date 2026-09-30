import { integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
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
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
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
  },
  (t) => [unique("board_project_slug").on(t.projectId, t.slug)],
);

/** Ordered columns of a board; the category gives each column its meaning. */
export const boardColumn = pgTable("board_column", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => board.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category", { enum: COLUMN_CATEGORIES }).notNull(),
  sortOrder: integer("sort_order").notNull(),
});

/** Areas that group systems within a project, such as Police or Vehicles. */
export const domain = pgTable("domain", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull(),
});

/** Delivery phases of a project, in order. */
export const phase = pgTable("phase", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  goal: text("goal").notNull().default(""),
  sortOrder: integer("sort_order").notNull(),
});

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
  (t) => [primaryKey({ columns: [t.phaseId, t.dependsOnId] })],
);
