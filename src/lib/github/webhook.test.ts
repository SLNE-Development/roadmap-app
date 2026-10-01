import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubApp, githubDelivery, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { encryptSecret } from "@/lib/crypto";
import { saveAppCredentials } from "@/lib/ops/github-app";
import { memoryQueue, type JobQueue, type MemoryQueue } from "@/lib/queue";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { createTestDb } from "@/test/db";
import { signBody } from "./signature";
import { handleWebhook } from "./webhook";

const NOW = new Date("2026-10-01T12:00:00Z");
const minutesLater = (n: number) => () => new Date(NOW.getTime() + n * 60_000);

const appInput = {
  appId: 42,
  slug: "roadmap-app",
  name: "Roadmap App",
  ownerLogin: "SLNE-Development",
  htmlUrl: "https://github.com/apps/roadmap-app",
  clientId: "Iv1.abc",
  clientSecret: "client-secret",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  webhookSecret: "whsec",
};

const repoPayload = (fullName = "Org/Repo") => JSON.stringify({ action: "opened", repository: { full_name: fullName } });

/** Builds a webhook request; `signature: null` leaves the header out. */
function hook(
  opts: {
    body?: string;
    secret?: string;
    signature?: string | null;
    event?: string;
    deliveryId?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const body = opts.body ?? repoPayload();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": opts.event ?? "pull_request",
    "x-github-delivery": opts.deliveryId ?? randomUUID(),
    ...opts.headers,
  };
  const signature = opts.signature === undefined ? signBody(opts.secret ?? "whsec", body) : opts.signature;
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return new Request("http://localhost/api/github/app", { method: "POST", headers, body });
}

/** A database with the App (webhook secret `whsec`, unless `withApp` is false) and one repo in webhook mode. */
async function setup(withApp = true): Promise<{ db: Db; queue: MemoryQueue; repoId: string }> {
  const db = await createTestDb();
  if (withApp) await saveAppCredentials(db, await insertUser(db, { isAdmin: true }), appInput);
  const { projectId } = await createProjectFixture(db);
  await db.insert(githubRepo).values({
    id: "repo-1",
    projectId,
    fullName: "Org/Repo",
    fullNameKey: "org/repo",
    mode: "webhook",
    webhookSecretEnc: encryptSecret("repo-secret"),
  });
  return { db, queue: memoryQueue(), repoId: "repo-1" };
}

const app = { source: "app" } as const;

describe("handleWebhook", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records and queues a signed app delivery once", async () => {
    const { db, queue } = await setup();
    const deliveryId = randomUUID();
    const deps = { db, queue, now: () => NOW };

    const first = await handleWebhook(deps, hook({ deliveryId }), app);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ queued: true });
    expect(await db.select().from(githubDelivery)).toMatchObject([
      { deliveryId, source: "app", event: "pull_request", status: "queued", repoId: null },
    ]);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({
      jobName: "github.event",
      data: { deliveryId, event: "pull_request", source: "app", repoId: null },
      opts: { jobId: deliveryId, attempts: 3, backoffMs: 10_000 },
    });

    const again = await handleWebhook(deps, hook({ deliveryId }), app);
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ duplicate: true });
    expect(await db.select().from(githubDelivery)).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it("refuses a bad or missing signature without writing", async () => {
    const { db, queue } = await setup();
    const deps = { db, queue, now: () => NOW };
    const bad = await handleWebhook(deps, hook({ secret: "nope" }), app);
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "Invalid signature." });
    expect((await handleWebhook(deps, hook({ signature: null }), app)).status).toBe(401);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("refuses a known repo's delivery with a wrong secret, no header or a sha1 header without writing", async () => {
    const { db, queue, repoId } = await setup();
    const deps = { db, queue, now: () => NOW };
    const target = { source: "repo", repoId } as const;
    const sha1 = `sha1=${createHmac("sha1", "repo-secret").update(repoPayload()).digest("hex")}`;
    for (const request of [hook({ secret: "nope" }), hook({ signature: null }), hook({ secret: "repo-secret", signature: sha1 })]) {
      const res = await handleWebhook(deps, request, target);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid signature." });
    }
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("answers 401 on the manual route for a repo in app mode", async () => {
    const { db, queue, repoId } = await setup();
    await db.update(githubRepo).set({ mode: "app" }).where(eq(githubRepo.id, repoId));
    const res = await handleWebhook({ db, queue, now: () => NOW }, hook({ secret: "repo-secret" }), { source: "repo", repoId });
    expect(res.status).toBe(401);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("accepts the previous secret until it expires", async () => {
    const { db, queue } = await setup();
    await db
      .update(githubApp)
      .set({ previousWebhookSecretEnc: encryptSecret("old"), previousSecretExpiresAt: new Date(NOW.getTime() + 10 * 60_000) });
    expect((await handleWebhook({ db, queue, now: minutesLater(5) }, hook({ secret: "old" }), app)).status).toBe(202);
    expect((await handleWebhook({ db, queue, now: minutesLater(11) }, hook({ secret: "old" }), app)).status).toBe(401);
  });

  it("answers an unknown repo like a bad signature and refuses another repository's payload", async () => {
    const { db, queue, repoId } = await setup();
    const deps = { db, queue, now: () => NOW };
    const unknown = await handleWebhook(deps, hook({ secret: "repo-secret" }), { source: "repo", repoId: "missing" });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "Invalid signature." });

    const other = await handleWebhook(deps, hook({ secret: "repo-secret", body: repoPayload("Other/Repo") }), {
      source: "repo",
      repoId,
    });
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: "This webhook belongs to another repository." });
    expect(queue.jobs).toHaveLength(0);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
  });

  it("queues a repo delivery and stamps its last event", async () => {
    const { db, queue, repoId } = await setup();
    const res = await handleWebhook(
      { db, queue, now: () => NOW },
      hook({ secret: "repo-secret", body: repoPayload("org/REPO") }),
      { source: "repo", repoId },
    );
    expect(res.status).toBe(202);
    expect(queue.jobs[0]).toMatchObject({ data: { source: "repo", repoId } });
    const [repo] = await db.select().from(githubRepo).where(eq(githubRepo.id, repoId));
    expect(repo.lastEventAt).toEqual(NOW);
  });

  it("answers a ping without queueing", async () => {
    const { db, queue, repoId } = await setup();
    const deps = { db, queue, now: () => NOW };
    const res = await handleWebhook(deps, hook({ event: "ping", body: "{}" }), app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const repoPing = await handleWebhook(deps, hook({ event: "ping", body: "{}", secret: "repo-secret" }), {
      source: "repo",
      repoId,
    });
    expect(repoPing.status).toBe(200);
    const [repo] = await db.select().from(githubRepo).where(eq(githubRepo.id, repoId));
    expect(repo.lastEventAt).toEqual(NOW);
    expect(queue.jobs).toHaveLength(0);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
  });

  it("refuses a body over 5 MB", async () => {
    const { db, queue } = await setup();
    const body = JSON.stringify({ blob: "x".repeat(6 * 1024 * 1024) });
    const res = await handleWebhook({ db, queue, now: () => NOW }, hook({ body }), app);
    expect(res.status).toBe(413);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
  });

  it("refuses a body announced over 5 MB before reading it", async () => {
    const { db, queue } = await setup();
    const request = hook({ headers: { "content-length": String(6 * 1024 * 1024) } });
    const res = await handleWebhook({ db, queue, now: () => NOW }, request, app);
    expect(res.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it("stops reading a streamed body at 5 MB", async () => {
    const { db, queue } = await setup();
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 50) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new Request("http://localhost/api/github/app", {
      method: "POST",
      headers: { "x-github-event": "pull_request", "x-github-delivery": randomUUID() },
      body,
      duplex: "half",
    } as RequestInit);
    const res = await handleWebhook({ db, queue, now: () => NOW }, request, app);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(15);
  });

  it("verifies the signature over the raw bytes", async () => {
    const { db, queue } = await setup();
    const bytes = Buffer.from(JSON.stringify({ action: "opened", repository: { full_name: "Org/Repo" }, note: "café" }), "utf8");
    const headers = {
      "x-github-event": "pull_request",
      "x-github-delivery": randomUUID(),
      "x-hub-signature-256": signBody("whsec", bytes),
    };
    const res = await handleWebhook({ db, queue, now: () => NOW }, new Request("http://localhost/api/github/app", { method: "POST", headers, body: bytes }), app);
    expect(res.status).toBe(202);
  });

  it("answers 404 when no app is configured", async () => {
    const { db, queue } = await setup(false);
    const res = await handleWebhook({ db, queue, now: () => NOW }, hook(), app);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No GitHub App is configured." });
  });

  it("refuses missing or malformed delivery headers and invalid JSON", async () => {
    const { db, queue } = await setup();
    const deps = { db, queue, now: () => NOW };
    const noEvent = hook();
    noEvent.headers.delete("x-github-event");
    expect((await handleWebhook(deps, noEvent, app)).status).toBe(400);
    expect((await handleWebhook(deps, hook({ deliveryId: "12345" }), app)).status).toBe(400);
    expect((await handleWebhook(deps, hook({ deliveryId: "a:b" }), app)).status).toBe(400);
    expect((await handleWebhook(deps, hook({ body: "{nope" }), app)).status).toBe(400);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("removes the delivery and answers 503 when the enqueue fails", async () => {
    const { db } = await setup();
    const queue: JobQueue = { add: () => Promise.reject(new Error("valkey down")) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleWebhook({ db, queue, now: () => NOW }, hook(), app);
    expect(res.status).toBe(503);
    expect(await db.select().from(githubDelivery)).toHaveLength(0);
  });
});
