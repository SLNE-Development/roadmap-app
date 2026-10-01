import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, eventSettings, requestLog } from "@/db/schema";
import { loadEventSecrets } from "@/lib/event-secrets";
import { loadPostSettings, setEventSecrets, updateEventSettings } from "@/lib/ops/event-settings";
import { startPost } from "@/lib/ops/request-posts";
import { cancelRequest, updateRequest } from "@/lib/ops/requests";
import { draftPost, postWorld, PUBLIC_URL, stubEncryptionKey } from "@/test/post-fixtures";
import { testDeps } from "../deps";
import { runJob } from "../jobs";
import { ensureDiscordEvent } from "./events-discord-event";
import "./events-post";

const BOT_TOKEN = "B".repeat(60);
const API = "https://discord.com/api/v10/guilds/42/scheduled-events";

beforeEach(stubEncryptionKey);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Answer = Response | Error;
const json = (status: number, data: unknown = {}) => new Response(JSON.stringify(data), { status });

/** Stubs fetch to answer from `answers` in order (then 200 with an id) and records every call. */
function stubFetch(answers: Answer[] = []) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const raw = init.body instanceof FormData ? (init.body.get("payload_json") as string) : (init.body as string | undefined);
    calls.push({ method: init.method ?? "GET", url, headers: (init.headers ?? {}) as Record<string, string>, body: raw ? JSON.parse(raw) : {} });
    const answer = answers[calls.length - 1] ?? json(200, { id: `auto${calls.length}` });
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return calls;
}

/** The post world with the guild id and, unless `bot` is false, the bot token set. */
async function botWorld(opts: { bot?: boolean } = {}) {
  const w = await postWorld();
  await updateEventSettings(w.db, w.manager, { guildId: "42" });
  if (opts.bot !== false) await setEventSecrets(w.db, w.admin, { botToken: BOT_TOKEN });
  const deps = testDeps(w.db);
  const reload = async () => (await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id)))[0];
  const settings = async () => (await w.db.select().from(eventSettings))[0];
  const ensure = async (note?: (message: string) => void) => ensureDiscordEvent(deps, await reload(), await loadPostSettings(w.db), await loadEventSecrets(w.db), note);
  const setEventId = () => w.db.update(eventRequest).set({ discordEventId: "555" }).where(eq(eventRequest.id, w.request.id));
  return { ...w, deps, ensure, reload, settings, setEventId };
}

describe("ensureDiscordEvent", () => {
  it("returns null without a bot token and calls nothing", async () => {
    const s = await botWorld({ bot: false });
    const calls = stubFetch();
    expect(await s.ensure()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null without a guild id", async () => {
    const w = await postWorld();
    await setEventSecrets(w.db, w.admin, { botToken: BOT_TOKEN });
    const calls = stubFetch();
    const [request] = await w.db.select().from(eventRequest);
    expect(await ensureDiscordEvent(testDeps(w.db), request, await loadPostSettings(w.db), await loadEventSecrets(w.db))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("creates the event once, stores the id at once and logs it; a second call creates nothing", async () => {
    const s = await botWorld();
    const calls = stubFetch([json(200, { id: "555" })]);
    expect(await s.ensure()).toEqual({ url: "https://discord.com/events/42/555" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(API);
    expect(calls[0].headers.Authorization).toBe(`Bot ${BOT_TOKEN}`);
    expect(calls[0].body).toMatchObject({ name: "Fixture event", entity_type: 3, privacy_level: 2, entity_metadata: { location: "Hafenwelt" } });
    expect(calls[0].body.scheduled_end_time).toBeDefined();
    expect((await s.reload()).discordEventId).toBe("555");
    const log = await s.db.select().from(requestLog).where(eq(requestLog.field, "post"));
    expect(log.map((l) => l.newValue)).toContain("discord event created");
    const row = await s.settings();
    expect(row.botStatus).toBe("ok");
    expect(row.botCheckedAt).not.toBeNull();
    expect(await s.ensure()).toEqual({ url: "https://discord.com/events/42/555" });
    expect(calls).toHaveLength(1);
  });

  it("answers null on a 403, sets botStatus denied and tells the caller why", async () => {
    const s = await botWorld();
    stubFetch([json(403, {})]);
    const notes: string[] = [];
    expect(await s.ensure((m) => notes.push(m))).toBeNull();
    expect((await s.settings()).botStatus).toBe("denied");
    expect((await s.reload()).discordEventId).toBeNull();
    expect(notes).toEqual(["Discord event could not be created (403)"]);
  });

  it("tells missing permissions apart from a bad token", async () => {
    const s = await botWorld();
    stubFetch([json(403, { code: 50013 })]);
    await s.ensure();
    expect((await s.settings()).botStatus).toBe("missing-permissions");
  });

  it("answers null on a rejection without claiming the token is bad", async () => {
    const s = await botWorld();
    stubFetch([json(400, { message: "Invalid Form Body" })]);
    const notes: string[] = [];
    expect(await s.ensure((m) => notes.push(m))).toBeNull();
    expect(notes).toEqual(["Discord event could not be created (400)"]);
    expect((await s.reload()).discordEventId).toBeNull();
    expect((await s.settings()).botStatus).toBeNull();
  });

  it("answers null on a 5xx, notes it without the token and stores no id", async () => {
    const s = await botWorld();
    stubFetch([json(500)]);
    const notes: string[] = [];
    expect(await s.ensure((m) => notes.push(m))).toBeNull();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Discord event could not be created");
    expect(notes[0]).not.toContain(BOT_TOKEN);
    expect((await s.reload()).discordEventId).toBeNull();
  });

  it("returns the stored event when another run stored one first", async () => {
    const s = await botWorld();
    stubFetch([json(200, { id: "777" }), new Response(null, { status: 204 })]);
    const [request] = await s.db.select().from(eventRequest);
    await s.setEventId();
    expect(await ensureDiscordEvent(s.deps, request, await loadPostSettings(s.db), await loadEventSecrets(s.db))).toEqual({ url: "https://discord.com/events/42/555" });
  });
});

describe("events.post with a bot token", () => {
  async function announce() {
    const s = await botWorld();
    const post = await draftPost(s.db, s.manager, s.request.id, "announcement", { text: "Kommt alle!", pingRole: true });
    await startPost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const run = () => runJob("deliver", "events.post", { postId: post.id, attempt: 1 }, s.deps);
    const row = async () => (await s.db.select().from(eventPost).where(eq(eventPost.id, post.id)))[0];
    return { ...s, post, run, row };
  }

  it("sends the event link as the last message on its own and keeps the ping on the first", async () => {
    const s = await announce();
    const calls = stubFetch([json(200, { id: "555" }), json(200, { id: "m1" }), json(200, { id: "m2" })]);
    await s.run();
    const webhook = calls.filter((c) => c.url.startsWith(PUBLIC_URL));
    expect(calls[0].url).toBe(API);
    expect(webhook).toHaveLength(2);
    expect(webhook[0].body.allowed_mentions).toEqual({ parse: [], roles: ["123456789012345678"] });
    expect(webhook[1].body).toMatchObject({ content: "https://discord.com/events/42/555", allowed_mentions: { parse: [] } });
    expect(webhook[1].body.embeds).toBeUndefined();
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.at(-1)).toMatchObject({ kind: "event-link", messageId: "m2" });
  });

  it("still posts the details card when Discord denies the event, and notes it on the post", async () => {
    const s = await announce();
    const calls = stubFetch([json(403, {}), json(200, { id: "m1" }), json(200, { id: "m2" })]);
    await s.run();
    const webhook = calls.filter((c) => c.url.startsWith(PUBLIC_URL));
    expect(webhook).toHaveLength(2);
    expect((webhook[1].body.embeds as { title: string }[])[0].title).toBe("Fixture event");
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.lastError).toBe("Discord event could not be created (403)");
    expect((await s.settings()).botStatus).toBe("denied");
  });

  it("keeps the created event when a later send fails and does not create it again on resume", async () => {
    const s = await announce();
    const first = stubFetch([json(200, { id: "555" }), json(500)]);
    await expect(s.run()).rejects.toThrow();
    expect(first.filter((c) => c.url === API)).toHaveLength(1);
    expect((await s.reload()).discordEventId).toBe("555");
    const second = stubFetch([json(200, { id: "m1" }), json(200, { id: "m2" })]);
    await s.run();
    expect(second.filter((c) => c.url === API)).toHaveLength(0);
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.at(-1)).toMatchObject({ kind: "event-link" });
  });

  it("queues the job again behind a 429 on the event call and sends nothing yet", async () => {
    const s = await announce();
    const calls = stubFetch([json(429, { retry_after: 2 })]);
    await s.run();
    const job = s.deps.queues.deliver.jobs.find((j) => j.opts.jobId === `event-post-${s.post.id}-1-r1`);
    expect(job?.opts.delayMs).toBe(2250);
    expect(calls).toHaveLength(1);
    expect((await s.row()).status).toBe("sending");
  });

  it("posts with the details card when creating the event fails with a 5xx", async () => {
    const s = await announce();
    const calls = stubFetch([json(500), json(200, { id: "m1" }), json(200, { id: "m2" })]);
    await s.run();
    const webhook = calls.filter((c) => c.url.startsWith(PUBLIC_URL));
    expect(webhook).toHaveLength(2);
    expect((webhook[1].body.embeds as { title: string }[])[0].title).toBe("Fixture event");
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.lastError).toContain("Discord event could not be created");
    expect(row.lastError).not.toContain(BOT_TOKEN);
    expect((await s.reload()).discordEventId).toBeNull();
  });

  it("falls back to the details card once the 429 cap is reached", async () => {
    const s = await announce();
    const calls = stubFetch([json(429, { retry_after: 1 }), json(200, { id: "m1" }), json(200, { id: "m2" })]);
    await runJob("deliver", "events.post", { postId: s.post.id, attempt: 1, retry: 10 }, s.deps);
    const webhook = calls.filter((c) => c.url.startsWith(PUBLIC_URL));
    expect(webhook).toHaveLength(2);
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.lastError).toBe("Discord event could not be created (rate limited)");
  });

  it("calls no Discord API without a bot token", async () => {
    const s = await botWorld({ bot: false });
    const post = await draftPost(s.db, s.manager, s.request.id, "announcement", { text: "Hallo" });
    await startPost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const calls = stubFetch();
    await runJob("deliver", "events.post", { postId: post.id, attempt: 1 }, s.deps);
    expect(calls.every((c) => !c.url.includes("/api/v10/"))).toBe(true);
  });
});

describe("keeping the event in sync", () => {
  const later = () => new Date(Date.now() + 40 * 86_400_000);
  const jobs = (s: { deps: ReturnType<typeof testDeps> }) => s.deps.queues.deliver.jobs.filter((j) => j.jobName === "events.discord-event");

  it("enqueues an update per saved change, also within one minute", async () => {
    const s = await botWorld();
    await s.setEventId();
    const queue = s.deps.queue("deliver");
    await updateRequest(s.db, s.manager, s.request.id, { startsAt: later() }, queue);
    await updateRequest(s.db, s.manager, s.request.id, { where: "Spawn" }, queue);
    expect(jobs(s)).toHaveLength(2);
    expect(jobs(s)[1].opts.jobId).not.toBe(jobs(s)[0].opts.jobId);
    expect(jobs(s)[0].data).toEqual({ requestId: s.request.id, action: "update" });
    expect(jobs(s)[0].opts).toMatchObject({ attempts: 3, backoffMs: 10_000 });
    expect(jobs(s)[0].opts.jobId).toMatch(new RegExp(`^event-dev-${s.request.id}-update-\\d+$`));
  });

  it("enqueues for a changed title and nothing for a change that is not on the event", async () => {
    const s = await botWorld();
    await s.setEventId();
    const queue = s.deps.queue("deliver");
    await updateRequest(s.db, s.manager, s.request.id, { requesterId: s.stranger.userId }, queue);
    expect(jobs(s)).toHaveLength(0);
    await updateRequest(s.db, s.manager, s.request.id, { title: "Neu" }, queue);
    expect(jobs(s)).toHaveLength(1);
  });

  it("enqueues nothing without a stored event id", async () => {
    const s = await botWorld();
    await updateRequest(s.db, s.manager, s.request.id, { startsAt: later() }, s.deps.queue("deliver"));
    expect(jobs(s)).toHaveLength(0);
  });

  it("enqueues nothing without a bot token, and an update without a queue still works", async () => {
    const s = await botWorld({ bot: false });
    await s.setEventId();
    await updateRequest(s.db, s.manager, s.request.id, { startsAt: later() }, s.deps.queue("deliver"));
    await cancelRequest(s.db, s.manager, s.request.id, { reason: "Sturm" }, s.deps.queue("deliver"));
    expect(jobs(s)).toHaveLength(0);
    const t = await botWorld();
    await t.setEventId();
    await expect(updateRequest(t.db, t.manager, t.request.id, { title: "Ohne Queue" })).resolves.toBeDefined();
  });

  it("enqueues a delete when the request is cancelled and the job clears the id", async () => {
    const s = await botWorld();
    await s.setEventId();
    await cancelRequest(s.db, s.manager, s.request.id, { reason: "Sturm" }, s.deps.queue("deliver"));
    expect(jobs(s).map((j) => j.data)).toEqual([{ requestId: s.request.id, action: "delete" }]);
    const calls = stubFetch([new Response(null, { status: 204 })]);
    await runJob("deliver", "events.discord-event", jobs(s)[0].data, s.deps);
    expect(calls[0]).toMatchObject({ method: "DELETE", url: `${API}/555` });
    expect((await s.reload()).discordEventId).toBeNull();
  });

  it("deletes the event of a deleted request by its ids without reading the request", async () => {
    const s = await botWorld();
    const calls = stubFetch([new Response(null, { status: 204 })]);
    await runJob("deliver", "events.discord-event", { requestId: "gone", action: "delete-orphan", guildId: "42", eventId: "555" }, s.deps);
    expect(calls[0]).toMatchObject({ method: "DELETE", url: `${API}/555` });
    await expect(runJob("deliver", "events.discord-event", { requestId: "gone", action: "delete-orphan", guildId: "4/../2", eventId: "555" }, s.deps)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("creates the event for a reopened request once and stores its id", async () => {
    const s = await botWorld();
    const calls = stubFetch([json(200, { id: "777" })]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "create" }, s.deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: API });
    expect((await s.reload()).discordEventId).toBe("777");
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "create" }, s.deps);
    expect(calls).toHaveLength(1);
  });

  it("creates no event when the request was cancelled again before the create ran", async () => {
    const s = await botWorld();
    await s.db.update(eventRequest).set({ status: "cancelled" }).where(eq(eventRequest.id, s.request.id));
    const calls = stubFetch([json(200, { id: "777" })]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "create" }, s.deps);
    expect(calls).toHaveLength(0);
    expect((await s.reload()).discordEventId).toBeNull();
  });

  it("queues the create again after Discord's delay on a 429", async () => {
    const s = await botWorld();
    stubFetch([new Response(JSON.stringify({ retry_after: 2 }), { status: 429, headers: { "Retry-After": "2" } })]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "create" }, s.deps);
    expect(jobs(s).map((j) => j.data)).toEqual([{ requestId: s.request.id, action: "create", retry: 1 }]);
    expect((await s.reload()).discordEventId).toBeNull();
  });

  it("counts a delete of an event that is already gone as deleted", async () => {
    const s = await botWorld();
    await s.setEventId();
    stubFetch([json(404)]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "delete" }, s.deps);
    expect((await s.reload()).discordEventId).toBeNull();
  });

  it("updates the event with the changed fields and the description's docs line", async () => {
    const s = await botWorld();
    await s.setEventId();
    await s.db.update(eventRequest).set({ eventDocsUrl: "https://example.com/infos" }).where(eq(eventRequest.id, s.request.id));
    const calls = stubFetch([json(200, { id: "555" })]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "update" }, s.deps);
    expect(calls[0]).toMatchObject({ method: "PATCH", url: `${API}/555` });
    expect(calls[0].body).toMatchObject({ name: "Fixture event", entity_metadata: { location: "Hafenwelt" } });
    expect(calls[0].body.description).toBe("Brief\n\nInfos: https://example.com/infos");
    expect(calls[0].body.scheduled_end_time).toBeDefined();
    expect((await s.reload()).discordEventId).toBe("555");
  });

  it("clears the id when the event is gone on update and stops", async () => {
    const s = await botWorld();
    await s.setEventId();
    const calls = stubFetch([json(404)]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "update" }, s.deps);
    expect(calls).toHaveLength(1);
    expect((await s.reload()).discordEventId).toBeNull();
    const log = await s.db.select().from(requestLog).where(eq(requestLog.field, "post"));
    expect(log.map((l) => l.newValue)).toContain("discord event gone");
  });

  it("does nothing for an update without a stored id or a job without a bot token", async () => {
    const s = await botWorld();
    const calls = stubFetch();
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "update" }, s.deps);
    const t = await botWorld({ bot: false });
    await t.setEventId();
    await runJob("deliver", "events.discord-event", { requestId: t.request.id, action: "delete" }, t.deps);
    expect(calls).toHaveLength(0);
    expect((await t.reload()).discordEventId).toBe("555");
  });

  it("records a denied token on the settings and does not retry", async () => {
    const s = await botWorld();
    await s.setEventId();
    stubFetch([json(401)]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "update" }, s.deps);
    expect((await s.settings()).botStatus).toBe("denied");
    expect((await s.reload()).discordEventId).toBe("555");
  });

  it("queues itself again behind a 429 and throws on a 5xx", async () => {
    const s = await botWorld();
    await s.setEventId();
    stubFetch([json(429, { retry_after: 1 })]);
    await runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "update" }, s.deps);
    expect(jobs(s)[0].opts.delayMs).toBe(1250);
    stubFetch([json(500)]);
    await expect(runJob("deliver", "events.discord-event", { requestId: s.request.id, action: "update" }, s.deps)).rejects.toThrow();
  });
});

describe("who may reach the bot client", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, file), "utf8");
  const posts = read("events-post.ts");
  /** The source of the top-level function `name` up to the next top-level declaration. */
  const body = (name: string) => {
    const start = posts.search(new RegExp(`function ${name}\\b`));
    expect(start, name).toBeGreaterThan(-1);
    const rest = posts.slice(start + 10);
    const end = rest.search(/\n(?:\/\*\*|export |const |async function |function |class |registerJob)/);
    return posts.slice(start, start + 10 + (end === -1 ? rest.length : end));
  };

  it("events-post.ts never imports the bot client and calls the event module from the events.post path only", () => {
    expect(posts).not.toMatch(/discord-bot/);
    expect(posts.match(/ensureDiscordEvent\(/g)).toHaveLength(1);
    expect(body("runPost")).toContain("ensureDiscordEvent(");
  });

  it("the test send, edit and delete code never mention the event module or the bot token", () => {
    for (const name of ["sendTest", "runEdit", "runDelete", "prepare", "settle", "partBody"]) {
      expect(body(name), name).not.toMatch(/ensureDiscordEvent|discord-bot|botToken/);
    }
    expect(body("sendTest")).not.toContain("loadEventSecrets");
  });

  it("the web-path ops never import the bot client or the secrets", () => {
    expect(read("events-discord-event.ts")).toContain("discord-bot");
    for (const file of ["../../lib/ops/requests.ts", "../../lib/ops/request-posts.ts"]) expect(read(file), file).not.toMatch(/discord-bot|event-secrets/);
  });
});

describe("the status line of a request", () => {
  it("says why there is no event, and links it once there is one", async () => {
    const { getRequest } = await import("@/lib/ops/requests");
    const s = await botWorld({ bot: false });
    expect((await getRequest(s.db, s.manager, s.request.id)).discordEvent).toEqual({ url: null, reason: "no-token" });
    await setEventSecrets(s.db, s.admin, { botToken: BOT_TOKEN });
    expect((await getRequest(s.db, s.manager, s.request.id)).discordEvent).toEqual({ url: null, reason: "not-yet" });
    await s.setEventId();
    expect((await getRequest(s.db, s.manager, s.request.id)).discordEvent).toEqual({ url: "https://discord.com/events/42/555", reason: "created" });
    await updateEventSettings(s.db, s.manager, { guildId: null });
    expect((await getRequest(s.db, s.manager, s.request.id)).discordEvent).toEqual({ url: null, reason: "no-guild" });
  });
});
