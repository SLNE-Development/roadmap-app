/** Environment variables the server refuses to start without. */
const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"];

/** Runs once when the Node server starts: checks the environment, then applies pending migrations. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  for (const name of REQUIRED) {
    if (!process.env[name]) throw new Error(`${name} is not set; see .env.example.`);
  }
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(process.env.DATABASE_URL as string);
}
