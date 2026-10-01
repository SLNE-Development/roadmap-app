import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";
import { project } from "./projects";

/** How an agent reached the server. */
export const AGENT_TRANSPORTS = ["mcp", "rest"] as const;

/**
 * One agent session of an API key: its calls while they keep coming within 10 minutes.
 * Telemetry, so never logged in `change_log`.
 */
export const agentRun = pgTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    /** The key that made the calls; no foreign key, since runs outlive revoked keys. */
    apiKeyId: text("api_key_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    repo: text("repo"),
    branch: text("branch"),
    /** The client's own session id, such as Claude Code's `session_id`. */
    clientSessionId: text("client_session_id"),
    startedAt: timestamp("started_at", tz).notNull().defaultNow(),
    lastCallAt: timestamp("last_call_at", tz).notNull().defaultNow(),
    callCount: integer("call_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }),
  },
  (t) => [
    index("agent_run_key_last_call").on(t.apiKeyId, t.lastCallAt.desc()),
    index("agent_run_user_last_call").on(t.userId, t.lastCallAt.desc()),
    uniqueIndex("agent_run_client_session").on(t.clientSessionId).where(sql`client_session_id is not null`),
  ],
);

/** One tool call of a run: which tool, where and how it went; never its input or output. */
export const agentCall = pgTable(
  "agent_call",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    at: timestamp("at", tz).notNull(),
    tool: text("tool").notNull(),
    transport: text("transport", { enum: AGENT_TRANSPORTS }).notNull(),
    /** The actor's agent label, such as "Claude Code". */
    agent: text("agent"),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    systemSlug: text("system_slug"),
    /** A short description of what the call touched, such as `task #188`. */
    target: text("target"),
    ok: boolean("ok").notNull(),
    status: integer("status").notNull(),
    /** The error message, cut to 300 characters. */
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [
    index("agent_call_run").on(t.runId, t.id),
    index("agent_call_project_at").on(t.projectId, t.at.desc()),
    index("agent_call_at").on(t.at),
  ],
);
