/** Environment variables the web app refuses to start without. */
export const APP_REQUIRED_ENV = [
  "DATABASE_URL",
  "VALKEY_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
] as const;

/** Environment variables the worker refuses to start without. */
export const WORKER_REQUIRED_ENV = ["DATABASE_URL", "VALKEY_URL"] as const;

/**
 * Checks that every named variable is set and non-empty.
 *
 * @throws Error naming the first missing or empty variable
 */
export function requireEnv(names: readonly string[], env: Record<string, string | undefined> = process.env): void {
  for (const name of names) {
    if (!env[name]) throw new Error(`${name} is not set; see .env.example.`);
  }
}
