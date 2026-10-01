import { eq } from "drizzle-orm";
import { githubDelivery } from "@/db/schema";
import type { Db } from "@/db/types";
import { getGitHubApi, type GitHubApi } from "@/lib/github/api";
import type { GitHubEventJob } from "@/lib/github/webhook";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob } from "../jobs";

/** How a handler dealt with a delivery; stored as the delivery's status. */
export interface DeliveryOutcome {
  status: "done" | "ignored" | "skipped";
  detail?: string;
}

export type GitHubEventHandler = (job: GitHubEventJob, deps: WorkerDeps, api: GitHubApi) => Promise<DeliveryOutcome>;

const MAX_DETAIL = 500;
const eventHandlers = new Map<string, GitHubEventHandler>();

/**
 * Registers the handler for a GitHub event, such as `pull_request`.
 *
 * @throws Error if the event already has a handler
 */
export function onGitHubEvent(event: string, handler: GitHubEventHandler): void {
  if (eventHandlers.has(event)) throw new Error(`GitHub event ${event} already has a handler`);
  eventHandlers.set(event, handler);
}

async function setStatus(db: Db, deliveryId: string, status: DeliveryOutcome["status"] | "failed", detail: string | null) {
  await db.update(githubDelivery).set({ status, detail }).where(eq(githubDelivery.deliveryId, deliveryId));
}

/**
 * Runs the handler registered for the delivery's event and stores its outcome on the delivery; an event without a
 * handler is `ignored`. A handler error marks the delivery `failed` and is rethrown so the job is retried.
 */
export async function handleGitHubEvent(
  data: unknown,
  deps: WorkerDeps,
  getApi: (db: Db) => Promise<GitHubApi> = getGitHubApi,
): Promise<void> {
  const job = data as GitHubEventJob;
  const handler = eventHandlers.get(job.event);
  if (!handler) {
    await setStatus(deps.db, job.deliveryId, "ignored", null);
    return;
  }
  let outcome: DeliveryOutcome;
  try {
    outcome = await handler(job, deps, await getApi(deps.db));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(deps.db, job.deliveryId, "failed", message.slice(0, MAX_DETAIL));
    throw error;
  }
  await setStatus(deps.db, job.deliveryId, outcome.status, outcome.detail ?? null);
}

registerJob(QUEUE.github, "github.event", (data, deps) => handleGitHubEvent(data, deps));
