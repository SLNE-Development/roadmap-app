import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Options for every timestamp column: with time zone, read as `Date`. */
export const tz = { withTimezone: true, mode: "date" } as const;

/** Signed-in accounts, managed by Better Auth; `discordId` and `isAdmin` are app fields. */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  discordId: text("discord_id").unique(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

/** Browser sessions, managed by Better Auth. */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", tz).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/** Linked OAuth accounts (Discord), managed by Better Auth. */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** Short-lived OAuth state values, managed by Better Auth. */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", tz).notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** Hashed per-user API keys, managed by the Better Auth api-key plugin; `referenceId` is the user id. */
export const apikey = pgTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").notNull().default("default"),
  name: text("name"),
  start: text("start"),
  referenceId: text("reference_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  prefix: text("prefix"),
  key: text("key").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at", tz),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window"),
  rateLimitMax: integer("rate_limit_max"),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request", tz),
  expiresAt: timestamp("expires_at", tz),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

/** Discord accounts the admin has provisioned; only these may sign in. */
export const allowedAccount = pgTable("allowed_account", {
  discordId: text("discord_id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});
