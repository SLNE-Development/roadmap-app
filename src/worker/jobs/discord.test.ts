import { randomBytes } from "node:crypto";
import { asc, eq, gt, max } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLog, discordOutbox, project, projectWebhook } from "@/db/schema";
import type { Db } from "@/db/types";
import type { DiscordEvent } from "@/lib/discord-events";
import { createBoard } from "@/lib/ops/boards";
import { addQuestion } from "@/lib/ops/questions";
import { createSystem, moveSystem } from "@/lib/ops/systems";
import { createWebhook } from "@/lib/ops/webhooks";
import { QUEUE } from "@/lib/queue";
import { completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { createTestDb } from "@/test/db";
import { handleDiscordEvents } from "../consumers/discord";
import { testDeps } from "../deps";
import type { ChangeEvent } from "../feed";
import { registeredJobs, registeredRepeatables, runJob } from "../jobs";
import "./discord";

const URL = "https://discord.com/api/webhooks/123456789/tok-en_abcd";
const NOW = new Date("2026-10-01T12:00:00Z");
const REASON = "Discord no longer accepts this webhook (404). Create a new webhook and paste its URL.";

/** A project with a planned system `core` and a webhook on all boards for `events`. */
async function setup(events: DiscordEvent[] = ["system.done"], extra: { boardIds?: string[]; digest?: boolean; timeZone?: string } = {}) {
  const db = await createTestDb();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const sys = await createSystem(db, owner, slug, { slug: "core", title: "Core" });
  await completePlanningFixture(db, sys.id);
  const { id: webhookId } = await createWebhook(db, owner, slug, { name: "#roadmap", url: URL, events, ...extra });
  return { db, owner, slug, projectId, webhookId };
}

/** Runs `fn` and returns the change-log rows it wrote. */
async function changes(db: Db, fn: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const [{ last }] = await db.select({ last: max(changeLog.id) }).from(changeLog);
  await fn();
  return db
    .select()
    .from(changeLog)
    .where(gt(changeLog.id, last ?? 0))
    .orderBy(asc(changeLog.id));
}

const outbox = (db: Db) => db.select().from(discordOutbox).orderBy(asc(discordOutbox.id));
const webhook = async (db: Db, id: string) => (await db.select().from(projectWebhook).where(eq(projectWebhook.id, id)))[0];

/** Queues the move of `core` into Done to the webhook, returning the deps used. */
async function queued(db: Db, owner: Parameters<typeof moveSystem>[1], slug: string) {
  const deps = testDeps(db, { now: () => NOW });
  const events = await changes(db, () => moveSystem(db, owner, slug, "core", { column: "Done" }));
  await handleDiscordEvents(events, deps);
  return { deps, events };
}

describe("discord delivery", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("BETTER_AUTH_URL", "https://roadmap.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("registers the consumer, the jobs and the hourly digest", async () => {
    await import("../consumers/index");
    const { registeredFeedConsumers } = await import("../feed");
    expect(registeredFeedConsumers().map((c) => c.name)).toContain("discord");
    expect(registeredJobs()).toEqual(
      expect.arrayContaining([
        { queue: QUEUE.deliver, jobName: "discord.flush" },
        { queue: QUEUE.deliver, jobName: "discord.test" },
        { queue: QUEUE.maintenance, jobName: "digest.weekly" },
      ]),
    );
    expect(registeredRepeatables()).toContainEqual({ queue: QUEUE.maintenance, jobName: "digest.weekly", schedule: { cron: "5 * * * *", tz: "UTC" }, data: undefined });
  });

  it("queues a move into Done once and schedules one flush", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps, events } = await queued(db, owner, slug);
    const rows = await outbox(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ webhookId, sentAt: null, payload: { event: "system.done", title: "Core is done", href: `https://roadmap.test/p/${slug}/systems/core` } });
    expect(deps.queues.deliver.jobs).toEqual([
      { jobName: "discord.flush", data: { webhookId }, opts: { jobId: `discord-flush-${webhookId}-${Math.floor(NOW.getTime() / 10000)}`, delayMs: 10000 } },
    ]);

    await handleDiscordEvents(events, deps);
    expect(await outbox(db)).toHaveLength(1);
    expect(deps.queues.deliver.jobs).toHaveLength(1);
  });

  it("queues nothing for a webhook on other boards", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const sys = await createSystem(db, owner, slug, { slug: "core", title: "Core" });
    await completePlanningFixture(db, sys.id);
    const other = await createBoard(db, owner, slug, { slug: "ops", name: "Ops" });
    await createWebhook(db, owner, slug, { name: "#ops", url: URL, events: ["system.done"], boardIds: [other.id] });
    const { deps } = await queued(db, owner, slug);
    expect(await outbox(db)).toEqual([]);
    expect(deps.queues.deliver.jobs).toEqual([]);
  });

  it("posts pending rows and marks them sent", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL}?wait=true`);
    expect(JSON.parse(String(init.body))).toMatchObject({ embeds: [{ title: "Core is done" }], allowed_mentions: { parse: [] } });
    expect((await outbox(db)).map((r) => r.sentAt)).toEqual([NOW]);
    expect((await webhook(db, webhookId)).lastSentAt).toEqual(NOW);
  });

  it("leaves the rows pending and retries after retry_after on 429", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ retry_after: 1.5 }, { status: 429 })));

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect((await outbox(db)).map((r) => r.sentAt)).toEqual([null]);
    expect(deps.queues.deliver.jobs.at(-1)).toEqual({
      jobName: "discord.flush",
      data: { webhookId, retry: 1 },
      opts: { jobId: `discord-flush-${webhookId}-${Math.floor(NOW.getTime() / 10000)}-retry-1`, delayMs: 1750 },
    });
  });

  it("disables the webhook on 404 and stops posting", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);
    expect(await webhook(db, webhookId)).toMatchObject({ enabled: false, disabledReason: REASON });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(webhookId));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("discord.com");

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("drops the webhook's pending rows when it disables it, so turning it back on replays nothing", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect((await outbox(db)).map((r) => r.sentAt)).toEqual([NOW]);
    warn.mockRestore();
  });

  it("posts nothing for an archived project", async () => {
    const { db, owner, slug, projectId, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    await db.update(project).set({ archivedAt: NOW }).where(eq(project.id, projectId));
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(fetch).not.toHaveBeenCalled();
    expect((await outbox(db)).map((r) => r.sentAt)).toEqual([null]);
  });

  it("disables the webhook on 401", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(await webhook(db, webhookId)).toMatchObject({ enabled: false, disabledReason: REASON });
    warn.mockRestore();
  });

  it("reads retry_after from the Retry-After header", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "2" } })));

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(deps.queues.deliver.jobs.at(-1)?.opts.delayMs).toBe(2250);
  });

  it("fails after 10 rate-limited retries in a row", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ retry_after: 1 }, { status: 429 })));

    await expect(runJob(QUEUE.deliver, "discord.flush", { webhookId, retry: 10 }, deps)).rejects.toThrow(/rate-limited/);
  });

  it("re-queues itself without posting while another flush holds the lock", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await deps.kv.setIfAbsent(`discord-flush:${webhookId}`, "1", 60);

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(fetch).not.toHaveBeenCalled();
    const bucket = Math.floor(NOW.getTime() / 10000);
    expect(deps.queues.deliver.jobs.at(-1)).toEqual({ jobName: "discord.flush", data: { webhookId, retry: 0, busy: 1 }, opts: { jobId: `discord-flush-${webhookId}-${bucket}-busy-1`, delayMs: 5000 } });

    await runJob(QUEUE.deliver, "discord.flush", deps.queues.deliver.jobs.at(-1)?.data, deps);
    expect(deps.queues.deliver.jobs.slice(-2).map((j) => j.opts.jobId)).toEqual([`discord-flush-${webhookId}-${bucket}-busy-1`, `discord-flush-${webhookId}-${bucket}-busy-2`]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails after 10 re-queues behind a held lock", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    await deps.kv.setIfAbsent(`discord-flush:${webhookId}`, "1", 60);

    await expect(runJob(QUEUE.deliver, "discord.flush", { webhookId, busy: 10 }, deps)).rejects.toThrow(/held the lock/);
  });

  it("queues a follow-up for rows added while it posted", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    const [first] = await outbox(db);
    const fetch = vi.fn(async () => {
      await db.insert(discordOutbox).values({ webhookId, changeLogId: 999_999, payload: first.payload });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(deps.queues.deliver.jobs.at(-1)?.opts.jobId).toBe(`discord-flush-${webhookId}-${Math.floor(NOW.getTime() / 10000)}-next-${first.id}`);
  });

  it("posts 50 rows and queues a follow-up flush for the rest", async () => {
    const { db, slug, webhookId } = await setup();
    const payload = (i: number) => ({ event: "task.changed", projectName: "DEMO", projectSlug: slug, title: `Task ${i}`, detail: "", href: "https://roadmap.test/p/demo", actorName: null, at: NOW.toISOString() });
    await db.insert(discordOutbox).values(Array.from({ length: 51 }, (_, i) => ({ webhookId, changeLogId: i + 1, payload: payload(i + 1) })));
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const deps = testDeps(db, { now: () => NOW });

    await runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps);

    expect(fetch).toHaveBeenCalledTimes(5);
    const rows = await outbox(db);
    expect(rows.filter((r) => r.sentAt === null).map((r) => r.changeLogId)).toEqual([51]);
    expect(deps.queues.deliver.jobs).toEqual([
      { jobName: "discord.flush", data: { webhookId }, opts: { jobId: `discord-flush-${webhookId}-${Math.floor(NOW.getTime() / 10000)}-next-${rows[49].id}`, delayMs: 2000 } },
    ]);
  });

  it("throws on 500 so the job is retried", async () => {
    const { db, owner, slug, webhookId } = await setup();
    const { deps } = await queued(db, owner, slug);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));

    await expect(runJob(QUEUE.deliver, "discord.flush", { webhookId }, deps)).rejects.toThrow(/500/);
    expect((await outbox(db)).map((r) => r.sentAt)).toEqual([null]);
  });

  it("sends a test message", async () => {
    const { db, webhookId } = await setup();
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await runJob(QUEUE.deliver, "discord.test", { webhookId }, testDeps(db, { now: () => NOW }));

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL}?wait=true`);
    expect(JSON.parse(String(init.body)).embeds[0].description).toBe("Test message from Roadmap for DEMO. Notifications will appear here.");
  });

  it("sends the weekly digest on Monday at 09:00 local time, once", async () => {
    const { db, owner, slug, webhookId } = await setup(["system.done"], { digest: true, timeZone: "Europe/Berlin" });
    await addQuestion(db, owner, slug, { title: "Which DB?", system: "core", priority: "blocking" });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const at = (iso: string) => testDeps(db, { now: () => new Date(iso) });

    await runJob(QUEUE.maintenance, "digest.weekly", {}, at("2026-10-05T06:10:00Z"));
    expect(fetch).not.toHaveBeenCalled();

    await runJob(QUEUE.maintenance, "digest.weekly", {}, at("2026-10-05T07:10:00Z"));
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.embeds[0].fields).toEqual([{ name: "Open questions (1)", value: "• Blocking: Which DB?" }]);
    expect((await webhook(db, webhookId)).lastDigestAt).toEqual(new Date("2026-10-05T07:10:00Z"));

    await runJob(QUEUE.maintenance, "digest.weekly", {}, at("2026-10-05T07:40:00Z"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the digest when every section is empty", async () => {
    const { db, webhookId } = await setup(["system.done"], { digest: true, timeZone: "Europe/Berlin" });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await runJob(QUEUE.maintenance, "digest.weekly", {}, testDeps(db, { now: () => new Date("2026-10-05T07:10:00Z") }));

    expect(fetch).not.toHaveBeenCalled();
    expect((await webhook(db, webhookId)).lastDigestAt).toBeNull();
  });

  it("reports shipped systems from the last 7 days", async () => {
    const { db, owner, slug } = await setup(["system.done"], { digest: true, timeZone: "UTC" });
    await moveSystem(db, owner, slug, "core", { column: "Done" });
    await db.update(changeLog).set({ createdAt: new Date("2026-10-03T12:00:00Z") });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await runJob(QUEUE.maintenance, "digest.weekly", {}, testDeps(db, { now: () => new Date("2026-10-05T09:05:00Z") }));

    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.embeds[0].fields).toEqual([{ name: "Shipped (1)", value: "• Core" }]);
  });
});
