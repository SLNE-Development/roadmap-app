import { eq } from "drizzle-orm";
import { eventSettings } from "@/db/schema";
import type { Executor } from "@/db/types";
import { decryptSecret } from "@/lib/crypto";

/** The decrypted secrets, for the worker. */
export interface EventSecrets {
  publicWebhook: string | null;
  teamWebhook: string | null;
  staffWebhook: string | null;
  botToken: string | null;
}

/**
 * Decrypts the stored secrets. Only worker code imports this module; `event-secrets.test.ts` walks the import graph
 * from `src/app`, `src/server` and `src/components` and fails when it is reachable. It never creates the row.
 */
export async function loadEventSecrets(db: Executor): Promise<EventSecrets> {
  const [row] = await db.select().from(eventSettings).where(eq(eventSettings.id, "default")).limit(1);
  const plain = (enc: string | null | undefined) => (enc ? decryptSecret(enc) : null);
  return { publicWebhook: plain(row?.publicWebhookEnc), teamWebhook: plain(row?.teamWebhookEnc), staffWebhook: plain(row?.staffWebhookEnc), botToken: plain(row?.botTokenEnc) };
}

/**
 * Decrypts one webhook and nothing else: the staff test send uses this so it never touches the bot token.
 *
 * @returns the webhook url, or null when it is not set
 */
export async function loadWebhook(db: Executor, which: "public" | "team" | "staff"): Promise<string | null> {
  const column = { public: eventSettings.publicWebhookEnc, team: eventSettings.teamWebhookEnc, staff: eventSettings.staffWebhookEnc }[which];
  const [row] = await db.select({ enc: column }).from(eventSettings).where(eq(eventSettings.id, "default")).limit(1);
  return row?.enc ? decryptSecret(row.enc) : null;
}
