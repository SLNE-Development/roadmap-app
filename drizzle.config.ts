import { defineConfig } from "drizzle-kit";

/** drizzle-kit configuration: generates SQL migrations from the schema into ./drizzle. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/roadmap" },
});
