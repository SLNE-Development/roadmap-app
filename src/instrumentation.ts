import { APP_REQUIRED_ENV, requireEnv } from "@/lib/env";

/** Runs once when the Node server starts: checks the environment and the encryption key, then applies pending migrations. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  requireEnv(APP_REQUIRED_ENV);
  const { checkEncryptionKey } = await import("@/lib/crypto");
  checkEncryptionKey();
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(process.env.DATABASE_URL as string);
}
