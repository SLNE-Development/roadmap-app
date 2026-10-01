import { eq } from "drizzle-orm";
import { z } from "zod";
import { githubApp, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Actor } from "./actor";
import { ForbiddenError, InvalidError } from "./errors";

/** Input of {@link saveAppCredentials}: what GitHub shows after the App is registered. */
export const appCredentialsInput = z.object({
  appId: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "invalid slug"),
  name: z.string().trim().min(1),
  ownerLogin: z.string().trim().min(1),
  htmlUrl: z.string().trim().min(1).startsWith("https://github.com/", "must start with https://github.com/"),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(200),
  privateKey: z
    .string()
    .refine((v) => v.includes("-----BEGIN") && v.includes("PRIVATE KEY-----"), "must be a PEM private key"),
  webhookSecret: z.string().trim().min(1).max(200),
});

/** The GitHub App with its secrets decrypted; for server code only. */
export interface GitHubAppConfig {
  appId: number;
  slug: string;
  name: string;
  ownerLogin: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
  previousWebhookSecret: string | null;
  previousSecretExpiresAt: Date | null;
  linkPolicy: "owners" | "admins";
}

/** The GitHub App as admins see it: everything except the secrets. */
export interface AppSummary {
  appId: number;
  slug: string;
  name: string;
  ownerLogin: string;
  htmlUrl: string;
  linkPolicy: "owners" | "admins";
  createdAt: Date;
  createdByName: string | null;
}

/**
 * Stores the App's credentials, encrypting the secrets. Replaces the existing row but keeps its link policy.
 * Not written to `change_log`, which is per project.
 *
 * @throws ForbiddenError unless the actor is an admin
 * @throws InvalidError when the input does not match
 */
export async function saveAppCredentials(db: Db, actor: Actor, raw: z.input<typeof appCredentialsInput>): Promise<void> {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can configure the GitHub App.");
  const parsed = appCredentialsInput.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const c = parsed.data;
  const values = {
    appId: c.appId,
    slug: c.slug,
    name: c.name,
    ownerLogin: c.ownerLogin,
    htmlUrl: c.htmlUrl,
    clientId: c.clientId,
    clientSecretEnc: encryptSecret(c.clientSecret),
    privateKeyEnc: encryptSecret(c.privateKey),
    webhookSecretEnc: encryptSecret(c.webhookSecret),
    updatedAt: new Date(),
  };
  await db
    .insert(githubApp)
    .values({ id: "default", ...values, createdBy: actor.userId })
    .onConflictDoUpdate({ target: githubApp.id, set: values });
  console.info("github app configured", c.appId);
}

/** Returns the App with its secrets decrypted, or null when none is configured. */
export async function loadAppConfig(db: Db): Promise<GitHubAppConfig | null> {
  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, "default"));
  if (!row) return null;
  return {
    appId: row.appId,
    slug: row.slug,
    name: row.name,
    ownerLogin: row.ownerLogin,
    htmlUrl: row.htmlUrl,
    clientId: row.clientId,
    clientSecret: decryptSecret(row.clientSecretEnc),
    privateKey: decryptSecret(row.privateKeyEnc),
    webhookSecret: decryptSecret(row.webhookSecretEnc),
    previousWebhookSecret: row.previousWebhookSecretEnc ? decryptSecret(row.previousWebhookSecretEnc) : null,
    previousSecretExpiresAt: row.previousSecretExpiresAt,
    linkPolicy: row.linkPolicy,
  };
}

/**
 * Returns the App without its secrets, or null when none is configured.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function getAppSummary(db: Db, actor: Actor): Promise<AppSummary | null> {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can view the GitHub App.");
  const [row] = await db
    .select({
      appId: githubApp.appId,
      slug: githubApp.slug,
      name: githubApp.name,
      ownerLogin: githubApp.ownerLogin,
      htmlUrl: githubApp.htmlUrl,
      linkPolicy: githubApp.linkPolicy,
      createdAt: githubApp.createdAt,
      createdByName: user.name,
    })
    .from(githubApp)
    .leftJoin(user, eq(user.id, githubApp.createdBy))
    .where(eq(githubApp.id, "default"));
  return row ?? null;
}
