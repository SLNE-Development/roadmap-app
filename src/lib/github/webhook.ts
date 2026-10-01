import { eq } from "drizzle-orm";
import { githubDelivery, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { decryptSecret } from "@/lib/crypto";
import { loadAppConfig } from "@/lib/ops/github-app";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import { verifySignature } from "./signature";

/** Data of the `github.event` job on `QUEUE.github`. */
export interface GitHubEventJob {
  deliveryId: string;
  event: string;
  source: "app" | "repo";
  repoId: string | null;
  payload: unknown;
}

/** Which endpoint received the delivery: the App's, or a repository's manual webhook. */
export type WebhookTarget = { source: "app" } | { source: "repo"; repoId: string };

const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** GitHub's `X-GitHub-Delivery` is a GUID; it doubles as the job id, so nothing else is accepted. */
const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status: number) => Response.json(body, { status });
const invalidSignature = () => json({ error: "Invalid signature." }, 401);
const tooLarge = () => json({ error: "The payload is larger than 5 MB." }, 413);

/**
 * Returns the secrets a delivery may be signed with, or a response refusing it. An unknown repo, one not in
 * webhook mode or one without a secret gets the bad-signature answer, so repo ids cannot be probed.
 */
async function secretsFor(db: Db, target: WebhookTarget, now: Date): Promise<string[] | Response> {
  if (target.source === "app") {
    const config = await loadAppConfig(db);
    if (!config) return json({ error: "No GitHub App is configured." }, 404);
    const secrets = [config.webhookSecret];
    if (config.previousWebhookSecret && config.previousSecretExpiresAt && config.previousSecretExpiresAt > now) {
      secrets.push(config.previousWebhookSecret);
    }
    return secrets;
  }
  const [repo] = await db
    .select({ mode: githubRepo.mode, webhookSecretEnc: githubRepo.webhookSecretEnc })
    .from(githubRepo)
    .where(eq(githubRepo.id, target.repoId));
  if (!repo || repo.mode !== "webhook" || !repo.webhookSecretEnc) return invalidSignature();
  return [decryptSecret(repo.webhookSecretEnc)];
}

/** Reads the request body as raw bytes, or returns null as soon as it grows past the limit; nothing more is buffered after that. */
async function readBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Returns `payload.repository.full_name`, or null when the payload has none. */
function repositoryName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const repository = (payload as { repository?: unknown }).repository;
  if (typeof repository !== "object" || repository === null) return null;
  const fullName = (repository as { full_name?: unknown }).full_name;
  return typeof fullName === "string" ? fullName : null;
}

/**
 * Verifies a GitHub webhook delivery, records it in `github_delivery` and queues a `github.event` job; never
 * calls GitHub. A repeated delivery id is answered as a duplicate without queueing; when queueing fails the
 * delivery row is removed again and the answer is 503, so GitHub's redelivery is not taken for a duplicate.
 */
export async function handleWebhook(
  deps: { db: Db; queue: JobQueue; now: () => Date },
  request: Request,
  target: WebhookTarget,
): Promise<Response> {
  const { db } = deps;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const body = await readBody(request);
  if (!body) return tooLarge();

  const now = deps.now();
  const secrets = await secretsFor(db, target, now);
  if (secrets instanceof Response) return secrets;
  if (!verifySignature(secrets, body, request.headers.get("x-hub-signature-256"))) return invalidSignature();

  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  if (!deliveryId || !event) return json({ error: "Missing X-GitHub-Delivery or X-GitHub-Event header." }, 400);
  if (!DELIVERY_ID.test(deliveryId)) return json({ error: "Invalid X-GitHub-Delivery header." }, 400);

  const repoId = target.source === "repo" ? target.repoId : null;
  const stampRepo = async () => {
    if (repoId) await db.update(githubRepo).set({ lastEventAt: now }).where(eq(githubRepo.id, repoId));
  };
  if (event === "ping") {
    await stampRepo();
    return json({ ok: true }, 200);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ error: "The payload is not valid JSON." }, 400);
  }
  if (repoId) {
    const [repo] = await db.select({ fullNameKey: githubRepo.fullNameKey }).from(githubRepo).where(eq(githubRepo.id, repoId));
    if (repositoryName(payload)?.toLowerCase() !== repo?.fullNameKey) {
      return json({ error: "This webhook belongs to another repository." }, 400);
    }
  }

  const inserted = await db
    .insert(githubDelivery)
    .values({ deliveryId, source: target.source, event, repoId, receivedAt: now })
    .onConflictDoNothing({ target: githubDelivery.deliveryId })
    .returning({ deliveryId: githubDelivery.deliveryId });
  if (inserted.length === 0) return json({ duplicate: true }, 202);

  const job: GitHubEventJob = { deliveryId, event, source: target.source, repoId, payload };
  try {
    await addWithTimeout(deps.queue, "github.event", job, { jobId: deliveryId, attempts: 3, backoffMs: 10_000 });
  } catch (error) {
    console.error("github webhook: could not queue delivery", deliveryId, error);
    await db.delete(githubDelivery).where(eq(githubDelivery.deliveryId, deliveryId));
    return json({ error: "The delivery could not be queued; try again later." }, 503);
  }
  await stampRepo();
  return json({ queued: true }, 202);
}
