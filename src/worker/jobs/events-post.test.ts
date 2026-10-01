import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, eventSettings, eventTodo, eventUpload, requestLog } from "@/db/schema";
import { GERMAN } from "@/lib/event-messages";
import * as secrets from "@/lib/event-secrets";
import * as events from "./events-discord-event";
import { setEventSecrets, updateEventSettings } from "@/lib/ops/event-settings";
import { deletePost, editPost, postDisaster, resolveDisaster, resumePost, savePostDraft, startPost, testSend } from "@/lib/ops/request-posts";
import { draftPost, longText, postWorld, PUBLIC_TOKEN, PUBLIC_URL, ROLE_ID, stubEncryptionKey, TEAM_TOKEN } from "@/test/post-fixtures";
import { testDeps } from "../deps";
import { runJob } from "../jobs";
import "./events-post";

beforeEach(stubEncryptionKey);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Answer = Response | Error;
const ok = (id: string) => new Response(JSON.stringify({ id }), { status: 200 });
const status = (code: number, body: unknown = {}) => new Response(JSON.stringify(body), { status: code });

/** Stubs fetch to answer from `answers` in order and records every call. */
function stubFetch(answers: Answer[]) {
  const calls: { method: string; url: string; body: Record<string, unknown>; multipart: boolean }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const multipart = init.body instanceof FormData;
    const raw = multipart ? ((init.body as FormData).get("payload_json") as string) : (init.body as string | undefined);
    calls.push({ method: init.method ?? "GET", url, body: raw ? JSON.parse(raw) : {}, multipart });
    const answer = answers[calls.length - 1] ?? ok(`auto${calls.length}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return calls;
}

/** A world with a started 3-part announcement that pings the role; the job has not run. */
async function started(over: { kind?: "announcement" | "team" | "reminder"; text?: string; pingRole?: boolean } = {}) {
  const w = await postWorld();
  const deps = testDeps(w.db);
  const kind = over.kind ?? "announcement";
  const post = await draftPost(w.db, w.manager, w.request.id, kind, { text: over.text ?? longText(3900), pingRole: over.pingRole ?? kind !== "team" });
  await startPost(w.db, w.manager, w.request.id, kind, deps.queue("deliver"));
  const run = (data: unknown = { postId: post.id, attempt: 1 }) => runJob("deliver", "events.post", data, deps);
  const row = async () => (await w.db.select().from(eventPost).where(eq(eventPost.id, post.id)))[0];
  return { ...w, deps, post, run, row };
}

describe("events.post", () => {
  it("sends every part in order, stores the ids, pings only with part 1 and ticks the to-do", async () => {
    const s = await started();
    const calls = stubFetch([ok("m1"), ok("m2"), ok("m3")]);
    await s.run();
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.url === `${PUBLIC_URL}?wait=true`)).toBe(true);
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [], roles: [ROLE_ID] });
    expect(calls[0].body.content as string).toMatch(new RegExp(`^<@&${ROLE_ID}>`));
    for (const c of calls.slice(1)) expect(c.body.allowed_mentions).toEqual({ parse: [] });
    expect(calls.every((c) => c.body.username === "Event-Team")).toBe(true);
    expect(calls[2].body.content).toBeUndefined();
    expect((calls[2].body.embeds as { title: string }[])[0].title).toBe("Fixture event");
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(row.parts.every((p) => p.sentAt !== null)).toBe(true);
    expect(row.postedAt).not.toBeNull();
    expect(row.postedBy).toBe(s.manager.userId);
    expect(row.lastError).toBeNull();
    const [todo] = await s.db.select().from(eventTodo).where(eq(eventTodo.templateKey, "announcement"));
    expect(todo.doneAt).not.toBeNull();
    expect(todo.doneBy).toBe(s.manager.userId);
    const log = await s.db.select().from(requestLog).where(eq(requestLog.field, "post"));
    expect(log.map((l) => l.newValue)).toContain("announcement posted");
  });

  it("posts a team notice and its details card to the team webhook", async () => {
    const s = await started({ kind: "team", text: "Team, bitte vorbereiten.", pingRole: false });
    const calls = stubFetch([ok("t1"), ok("t2")]);
    await s.run();
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("111111111111111111");
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
    const [todo] = await s.db.select().from(eventTodo).where(eq(eventTodo.templateKey, "team-message"));
    expect(todo.doneAt).not.toBeNull();
  });

  it("resumes after a 5xx: sends only the parts without an id and never pings again", async () => {
    const s = await started();
    const first = stubFetch([ok("m1"), status(500)]);
    await expect(s.run()).rejects.toThrow();
    expect(first).toHaveLength(2);
    let row = await s.row();
    expect(row.status).toBe("partial");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", null, null]);
    expect(row.lastError).toContain("part 2");
    const retry = stubFetch([ok("m2"), ok("m3")]);
    await s.run();
    expect(retry).toHaveLength(2);
    for (const c of retry) expect(c.body.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(retry.map((c) => c.body))).not.toContain("<@&");
    row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps the post retryable (partial) when nothing was sent yet, and retries from the start", async () => {
    const s = await started();
    stubFetch([new Error("socket hang up")]);
    await expect(s.run()).rejects.toThrow();
    expect((await s.row()).status).toBe("partial");
    const retry = stubFetch([ok("m1"), ok("m2"), ok("m3")]);
    await s.run();
    expect(retry).toHaveLength(3);
    expect((await s.row()).status).toBe("posted");
  });

  it("stores nothing for a rate-limited part and queues a delayed retry with the same attempt", async () => {
    const s = await started();
    stubFetch([ok("m1"), status(429, { retry_after: 2 })]);
    await s.run();
    const row = await s.row();
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", null, null]);
    expect(row.status).toBe("sending");
    const job = s.deps.queues.deliver.jobs.find((j) => j.opts.jobId === `event-post-${s.post.id}-1-r1`);
    expect(job).toMatchObject({ jobName: "events.post", data: { postId: s.post.id, attempt: 1, retry: 1 }, opts: { delayMs: 2250 } });
    const calls = stubFetch([ok("m2"), ok("m3")]);
    await s.run(job!.data);
    expect(calls).toHaveLength(2);
    expect((await s.row()).status).toBe("posted");
  });

  it("stops with a visible error when Discord answers 404, without a retry and without the url", async () => {
    const s = await started();
    stubFetch([ok("m1"), status(404)]);
    const before = s.deps.queues.deliver.jobs.length;
    await s.run();
    const row = await s.row();
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("Discord no longer accepts the public webhook (404). An admin must set a new one.");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", null, null]);
    expect(s.deps.queues.deliver.jobs).toHaveLength(before);
    expect(JSON.stringify(row)).not.toContain(PUBLIC_TOKEN);
    const [todo] = await s.db.select().from(eventTodo).where(eq(eventTodo.templateKey, "announcement"));
    expect(todo.doneAt).toBeNull();
  });

  it("stops with a visible error on a 400, without throwing or retrying", async () => {
    const s = await started();
    stubFetch([status(400, { message: "Invalid Form Body" })]);
    const before = s.deps.queues.deliver.jobs.length;
    await s.run();
    const row = await s.row();
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("Discord rejected part 1 of the announcement post (400).");
    expect(s.deps.queues.deliver.jobs).toHaveLength(before);
    const again = stubFetch([ok("x")]);
    await s.run();
    expect(again).toHaveLength(0);
  });

  it("deletes only its own lock", async () => {
    const s = await started();
    vi.stubGlobal("fetch", async () => {
      await s.deps.kv.set(`event-post:${s.post.id}`, "someone-else", 300);
      return ok("m1");
    });
    await s.run();
    expect(await s.deps.kv.get(`event-post:${s.post.id}`)).toBe("someone-else");
  });

  it("sends nothing for a stale job or a post that is not in flight", async () => {
    const s = await started();
    const calls = stubFetch([]);
    await s.run({ postId: s.post.id, attempt: 0 });
    await s.run({ postId: "unknown", attempt: 1 });
    await s.db.update(eventPost).set({ attempt: 2 }).where(eq(eventPost.id, s.post.id));
    await s.run({ postId: s.post.id, attempt: 1 });
    await s.db.update(eventPost).set({ attempt: 1, status: "posted" }).where(eq(eventPost.id, s.post.id));
    await s.run();
    expect(calls).toHaveLength(0);
  });

  it("re-queues once with a 5 s delay while another job holds the lock, and keeps waiting longer than the lock lives", async () => {
    const s = await started();
    const calls = stubFetch([]);
    await s.deps.kv.set(`event-post:${s.post.id}`, "1", 120);
    const before = s.deps.queues.deliver.jobs.length;
    await s.run();
    expect(calls).toHaveLength(0);
    const added = s.deps.queues.deliver.jobs.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ data: { postId: s.post.id, attempt: 1, busy: 1 }, opts: { delayMs: 5000, jobId: `event-post-${s.post.id}-1-b1` } });
    // The give-up window outlasts the 300 s lock: 60 re-queues of 5 s are still waiting, the cap comes after.
    await s.run({ postId: s.post.id, attempt: 1, busy: 60 });
    expect(s.deps.queues.deliver.jobs.at(-1)).toMatchObject({ data: { busy: 61 } });
    await expect(s.run({ postId: s.post.id, attempt: 1, busy: 200 })).rejects.toThrow(/lock/);
  });

  it("leaves the post partial (resumable) when the job fails for a reason that is not a Discord answer", async () => {
    const s = await started();
    await s.db.update(eventSettings).set({ publicWebhookEnc: "garbage" });
    const calls = stubFetch([]);
    await expect(s.run()).rejects.toThrow();
    expect(calls).toHaveLength(0);
    const row = await s.row();
    expect(row.status).toBe("partial");
    expect(row.lastError).toMatch(/^The job failed: /);
    expect(await s.deps.kv.get(`event-post:${s.post.id}`)).toBeNull();
  });

  it("stops sending when a resume took the post over while Discord answered", async () => {
    const s = await started();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      // The click of a resume lands while this part is in flight.
      await s.db.update(eventPost).set({ attempt: 2 }).where(eq(eventPost.id, s.post.id));
      return ok(`m${calls.length}`);
    });
    await s.run();
    expect(calls).toHaveLength(1);
    const row = await s.row();
    expect(row.attempt).toBe(2);
    expect(row.parts.every((p) => p.messageId === null)).toBe(true);
    expect(row.status).toBe("sending");
  });

  it("sends nothing and creates no Discord event when the request was cancelled after the click", async () => {
    const s = await started();
    await s.db.update(eventRequest).set({ status: "cancelled" }).where(eq(eventRequest.id, s.request.id));
    const spy = vi.spyOn(events, "ensureDiscordEvent");
    const calls = stubFetch([]);
    await s.run();
    expect(calls).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    const row = await s.row();
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("The request is cancelled; nothing was posted.");
    spy.mockRestore();
  });

  it("sends a disaster only in the event week", async () => {
    const w = await postWorld({ status: "event_week" });
    const deps = testDeps(w.db);
    await postDisaster(w.db, w.manager, w.request.id, {}, deps.queue("deliver"));
    await w.db.update(eventRequest).set({ status: "accepted" }).where(eq(eventRequest.id, w.request.id));
    const calls = stubFetch([]);
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.kind, "disaster"));
    await runJob("deliver", "events.post", { postId: row.id, attempt: row.attempt }, deps);
    expect(calls).toHaveLength(0);
    expect((await w.db.select().from(eventPost).where(eq(eventPost.id, row.id)))[0]).toMatchObject({ status: "failed", lastError: "The request is accepted; nothing was posted." });
  });

  it("releases the lock when it is done", async () => {
    const s = await started();
    stubFetch([ok("m1"), ok("m2"), ok("m3")]);
    await s.run();
    expect(await s.deps.kv.get(`event-post:${s.post.id}`)).toBeNull();
  });

  it("fails visibly when the webhook was cleared after the click", async () => {
    const s = await started();
    await s.db.update(eventSettings).set({ publicWebhookEnc: null, publicWebhookHint: null });
    const calls = stubFetch([]);
    await s.run();
    expect(calls).toHaveLength(0);
    expect((await s.row()).lastError).toBe("The public webhook is not set. An admin sets it in Event settings.");
    expect((await s.row()).status).toBe("failed");
  });

  it("never lets the webhook url or its encrypted value into an error, a stored value or a log row", async () => {
    const s = await started();
    stubFetch([ok("m1"), new Error(`connect ECONNREFUSED ${PUBLIC_URL}`)]);
    const error = await s.run().then(
      () => null,
      (e: Error) => e,
    );
    expect(error).not.toBeNull();
    const [settings] = await s.db.select().from(eventSettings);
    const everything = JSON.stringify([error?.message, error?.stack?.split("\n")[0], await s.row(), await s.db.select().from(requestLog)]);
    expect(everything).not.toContain(PUBLIC_TOKEN);
    expect(everything).not.toContain(TEAM_TOKEN);
    expect(everything).not.toContain(settings.publicWebhookEnc!);
    expect(everything).not.toContain("discord.com/api/webhooks");
  });

  it("sends the banner of the details card as an attachment and goes on when its file is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "post-uploads-"));
    vi.stubEnv("EVENT_UPLOADS_DIR", dir);
    const w = await postWorld();
    const deps = testDeps(w.db);
    await w.db.insert(eventUpload).values({ id: "up1", requestId: w.request.id, uploaderId: w.manager.userId, purpose: "banner", originalName: "Mein Banner.png", mime: "image/png", bytes: 3, storageKey: "0123abcd-0000.png" });
    await w.db.update(eventRequest).set({ bannerUploadId: "up1" }).where(eq(eventRequest.id, w.request.id));
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Hallo zusammen" });
    await startPost(w.db, w.manager, w.request.id, "announcement", deps.queue("deliver"));
    const [post] = await w.db.select().from(eventPost);
    await writeFile(path.join(dir, "0123abcd-0000.png"), new Uint8Array([137, 80, 78]));
    const calls = stubFetch([ok("m1"), ok("m2")]);
    await runJob("deliver", "events.post", { postId: post.id, attempt: 1 }, deps);
    expect(calls[0].multipart).toBe(false);
    expect(calls[1].multipart).toBe(true);
    expect((calls[1].body.embeds as { thumbnail: { url: string } }[])[0].thumbnail.url).toBe("attachment://image.png");

    await w.db.update(eventPost).set({ status: "sending", attempt: 2, parts: post.parts }).where(eq(eventPost.id, post.id));
    await w.db.update(eventUpload).set({ storageKey: "0123abcd-9999.png" });
    const again = stubFetch([ok("n1"), ok("n2")]);
    await runJob("deliver", "events.post", { postId: post.id, attempt: 2 }, deps);
    expect(again[1].multipart).toBe(false);
    expect((again[1].body.embeds as { image?: unknown }[])[0].image).toBeUndefined();
    expect((await w.db.select().from(eventPost))[0].status).toBe("posted");
  });
});

const STAFF_TOKEN = "STAFFTOKENSECRET5555";
const STAFF_URL = `https://discord.com/api/webhooks/333333333333333333/${STAFF_TOKEN}`;
const BOT_TOKEN = "B".repeat(60);

/** A posted 3-part announcement (2 text parts + card, ids m1 to m3) ready to be edited, deleted or resumed. */
async function posted(text = longText(3900)) {
  const s = await started({ text });
  stubFetch([ok("m1"), ok("m2"), ok("m3")]);
  await s.run();
  const edit = (input: Parameters<typeof editPost>[4]) => editPost(s.db, s.manager, s.request.id, "announcement", input, s.deps.queue("deliver"));
  const lastJob = (name: string) => s.deps.queues.deliver.jobs.filter((j) => j.jobName === name).at(-1)!;
  const runLast = (name: string) => runJob("deliver", name, lastJob(name).data, s.deps);
  return { ...s, text, edit, lastJob, runLast };
}

const MORE = Array.from({ length: 2 }, (_, i) => `Neu ${i} ` + "y".repeat(380)).join("\n\n");

describe("events.edit", () => {
  it("patches only the changed text part, never pings and creates nothing", async () => {
    const s = await posted();
    await s.edit({ text: s.text + " NEU" });
    const calls = stubFetch([ok("m2")]);
    await s.runLast("events.edit");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(`${PUBLIC_URL}/messages/m2`);
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(calls)).not.toContain("roles");
    expect(calls[0].body.content as string).toMatch(/NEU$/);
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(row.parts[1].content).toMatch(/NEU$/);
  });

  it("patches every changed text part, keeps the role mention text and leaves an unchanged card alone", async () => {
    const s = await posted();
    await s.edit({ text: s.text.replace("# Fixture event", "# Fixture event 2") + " NEU" });
    const calls = stubFetch([]);
    await s.runLast("events.edit");
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "PATCH"]);
    expect(calls.map((c) => c.url)).toEqual([`${PUBLIC_URL}/messages/m1`, `${PUBLIC_URL}/messages/m2`]);
    expect(calls[0].body.content as string).toMatch(new RegExp(`^<@&${ROLE_ID}>`));
    for (const c of calls) expect(c.body.allowed_mentions).toEqual({ parse: [] });
    expect((await s.row()).parts.map((p) => p.messageId)).toEqual(["m1", "m2", "m3"]);
  });

  it("grows 2 to 3 text parts: deletes the card, sends the new text, then re-sends the card last", async () => {
    const s = await posted();
    await s.edit({ text: `${s.text}\n\n${MORE}` });
    const calls = stubFetch([ok("m3"), ok("n3"), ok("n4")]);
    await s.runLast("events.edit");
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "POST", "POST"]);
    expect(calls[0].url).toBe(`${PUBLIC_URL}/messages/m3`);
    expect(calls[1].url).toBe(`${PUBLIC_URL}?wait=true`);
    expect(calls[2].body.content).toBeUndefined();
    expect(JSON.stringify(calls)).not.toContain("<@&");
    for (const c of calls.filter((c) => c.method !== "DELETE")) expect(c.body.allowed_mentions).toEqual({ parse: [] });
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.map((p) => p.kind)).toEqual(["text", "text", "text", "embed"]);
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "n3", "n4"]);
  });

  it("leaves the post partial with the card id cleared when the card re-send fails, and resume sends only the card", async () => {
    const s = await posted();
    await s.edit({ text: `${s.text}\n\n${MORE}` });
    let posts = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return ok("m");
      return ++posts === 2 ? status(500) : ok("n3");
    });
    await expect(s.runLast("events.edit")).rejects.toThrow();
    const row = await s.row();
    expect(row.status).toBe("partial");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "n3", null]);
    expect(row.parts.at(-1)?.kind).toBe("embed");
    await resumePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const calls = stubFetch([ok("n4")]);
    await s.runLast("events.edit");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
    const done = await s.row();
    expect(done.status).toBe("posted");
    expect(done.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "n3", "n4"]);
  });

  it("shrinks 3 to 2 text parts: deletes only the surplus text message", async () => {
    const s = await posted(longText(5500));
    expect((await s.row()).parts).toHaveLength(4);
    await s.edit({ text: longText(3900) });
    const calls = stubFetch([]);
    await s.runLast("events.edit");
    const rest = calls.filter((c) => c.method !== "PATCH");
    expect(rest.map((c) => `${c.method} ${c.url}`)).toEqual([`DELETE ${PUBLIC_URL}/messages/m3`]);
    expect(calls.some((c) => c.url.endsWith("/auto4"))).toBe(false);
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "auto4"]);
  });

  it("re-sends a part that Discord answers 404 for (deleted by a human) as a new message", async () => {
    const s = await posted();
    await s.edit({ text: s.text + " NEU" });
    const calls = stubFetch([status(404), ok("n2")]);
    await s.runLast("events.edit");
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1].body.allowed_mentions).toEqual({ parse: [] });
    const row = await s.row();
    expect(row.status).toBe("posted");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "n2", "m3"]);
  });

  it("patches the card with its banner file when the card changed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "post-uploads-"));
    vi.stubEnv("EVENT_UPLOADS_DIR", dir);
    const s = await posted();
    await s.db.insert(eventUpload).values({ id: "up1", requestId: s.request.id, uploaderId: s.manager.userId, purpose: "banner", originalName: "b.png", mime: "image/png", bytes: 3, storageKey: "0123abcd-0000.png" });
    await writeFile(path.join(dir, "0123abcd-0000.png"), new Uint8Array([137, 80, 78]));
    await s.db.update(eventRequest).set({ bannerUploadId: "up1", title: "Neuer Titel" }).where(eq(eventRequest.id, s.request.id));
    await s.edit({ text: s.text });
    const calls = stubFetch([]);
    await s.runLast("events.edit");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PATCH", url: `${PUBLIC_URL}/messages/m3`, multipart: true });
    const embed = (calls[0].body.embeds as { title: string; thumbnail: { url: string } }[])[0];
    expect(embed.title).toBe("Neuer Titel");
    expect(embed.thumbnail.url).toBe("attachment://image.png");
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
  });

  it("an old edit job does nothing after a newer Delete took over the post", async () => {
    const s = await posted();
    await s.edit({ text: s.text + " NEU" });
    const old = s.lastJob("events.edit").data;
    stubFetch([status(500)]);
    await expect(runJob("deliver", "events.edit", old, s.deps)).rejects.toThrow();
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const calls = stubFetch([]);
    await runJob("deliver", "events.edit", old, s.deps);
    expect(calls).toHaveLength(0);
    stubFetch([]);
    await s.runLast("events.delete");
    expect((await s.row()).status).toBe("deleted");
  });

  it("sends nothing when the request was cancelled after the edit click, but a delete still runs", async () => {
    const s = await posted();
    await s.edit({ text: s.text + " NEU" });
    await s.db.update(eventRequest).set({ status: "cancelled" }).where(eq(eventRequest.id, s.request.id));
    const calls = stubFetch([]);
    await s.runLast("events.edit");
    expect(calls).toHaveLength(0);
    expect(await s.row()).toMatchObject({ status: "failed", lastError: "The request is cancelled; nothing was posted." });
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const del = stubFetch([]);
    await s.runLast("events.delete");
    expect(del.map((c) => c.method)).toEqual(["DELETE", "DELETE", "DELETE"]);
    expect((await s.row()).status).toBe("deleted");
  });

  it("does nothing for a job of an older edit", async () => {
    const s = await posted();
    await s.edit({ text: s.text + " EINS" });
    const first = s.lastJob("events.edit").data;
    await s.db.update(eventPost).set({ status: "posted" }).where(eq(eventPost.id, s.post.id));
    await s.edit({ text: s.text + " ZWEI" });
    const calls = stubFetch([]);
    await runJob("deliver", "events.edit", first, s.deps);
    expect(calls).toHaveLength(0);
  });
});

describe("events.delete", () => {
  it("deletes each stored id in order, counts a 404 as gone and calls nothing else", async () => {
    const s = await posted();
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const calls = stubFetch([ok("m1"), status(404), ok("m3")]);
    await s.runLast("events.delete");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([1, 2, 3].map((n) => `DELETE ${PUBLIC_URL}/messages/m${n}`));
    const row = await s.row();
    expect(row.status).toBe("deleted");
    expect(row.parts.every((p) => p.messageId === null)).toBe(true);
  });

  it("keeps the text as a new draft of the same kind, once, also when the job is replayed", async () => {
    const s = await posted();
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const job = s.deps.queues.deliver.jobs.filter((j) => j.jobName === "events.delete").at(-1)!;
    stubFetch([ok("m1"), ok("m2"), ok("m3")]);
    await runJob("deliver", "events.delete", job.data, s.deps);
    stubFetch([]);
    await runJob("deliver", "events.delete", job.data, s.deps);
    const rows = await s.db.select().from(eventPost).where(eq(eventPost.kind, "announcement"));
    expect(rows.map((p) => p.status).sort()).toEqual(["deleted", "draft"]);
    const old = rows.find((p) => p.status === "deleted")!;
    const draft = rows.find((p) => p.status === "draft")!;
    expect(draft).toMatchObject({ text: old.text, pingRole: old.pingRole, embed: old.embed, parts: [], createdBy: old.createdBy });
    expect(draft.pingRole).toBe(true);
    expect(await s.db.select().from(requestLog).where(eq(requestLog.newValue, "announcement kept as draft"))).toHaveLength(1);
  });

  it("an old delete job does nothing after a newer Edit took over the post", async () => {
    const s = await posted();
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const old = s.lastJob("events.delete").data;
    stubFetch([status(500)]);
    await expect(runJob("deliver", "events.delete", old, s.deps)).rejects.toThrow();
    await s.edit({ text: s.text + " NEU" });
    const calls = stubFetch([]);
    await runJob("deliver", "events.delete", old, s.deps);
    expect(calls).toHaveLength(0);
    expect((await s.row()).status).toBe("sending");
  });

  it("counts 404 Unknown Message (10008) as deleted but stops on Unknown Webhook (10015) without marking parts deleted", async () => {
    const s = await posted();
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    stubFetch([status(404, { code: 10015 })]);
    await s.runLast("events.delete");
    const row = await s.row();
    expect(row.status).toBe("partial");
    expect(row.lastError).toBe("Discord no longer accepts the public webhook (404). An admin must set a new one.");
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(row.parts.some((p) => p.deleted)).toBe(false);
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    stubFetch([status(404, { code: 10008 }), ok("m2"), ok("m3")]);
    await s.runLast("events.delete");
    expect((await s.row()).status).toBe("deleted");
  });

  it("stops on a 500, keeps the ids that are still there and deletes only the rest on retry", async () => {
    const s = await posted();
    await deletePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    stubFetch([ok("m1"), status(500)]);
    await expect(s.runLast("events.delete")).rejects.toThrow();
    let row = await s.row();
    expect(row.status).toBe("partial");
    expect(row.parts.map((p) => p.messageId)).toEqual([null, "m2", "m3"]);
    await expect(resumePost(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"))).rejects.toThrow(/delet/i);
    const calls = stubFetch([]);
    await s.runLast("events.delete");
    expect(calls.map((c) => c.url)).toEqual([`${PUBLIC_URL}/messages/m2`, `${PUBLIC_URL}/messages/m3`]);
    row = await s.row();
    expect(row.status).toBe("deleted");
  });
});

describe("events.test", () => {
  /** A world with an announcement draft that pings, the staff webhook and a bot token set. */
  async function testWorld() {
    const w = await postWorld();
    await setEventSecrets(w.db, w.admin, { staffWebhook: STAFF_URL, botToken: BOT_TOKEN });
    const deps = testDeps(w.db);
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: longText(3900), pingRole: true });
    return { ...w, deps, post };
  }

  it("goes only to the staff webhook, never pings, strips the role mention and stores nothing on the post", async () => {
    const s = await testWorld();
    await s.db.update(eventPost).set({ text: `<@&${ROLE_ID}>\n${s.post.text}` }).where(eq(eventPost.id, s.post.id));
    const before = JSON.stringify((await s.db.select().from(eventPost))[0]);
    const loadAll = vi.spyOn(secrets, "loadEventSecrets");
    const ensure = vi.spyOn(events, "ensureDiscordEvent");
    await testSend(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const calls = stubFetch([]);
    const job = s.deps.queues.deliver.jobs.find((j) => j.jobName === "events.test")!;
    await runJob("deliver", "events.test", job.data, s.deps);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.method === "POST" && c.url === `${STAFF_URL}?wait=true`)).toBe(true);
    for (const c of calls) expect(c.body.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(calls)).not.toContain("<@&");
    expect((calls[0].body.content as string).split("\n")[0]).toBe(GERMAN.testMarker);
    expect(calls.at(-1)?.body.content).toBeUndefined();
    expect((calls.at(-1)?.body.embeds as { title: string }[])[0].title).toBe("Fixture event");
    expect(loadAll).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(calls.every((c) => !c.url.includes("/api/v10/"))).toBe(true);
    expect(JSON.stringify((await s.db.select().from(eventPost))[0])).toBe(before);
    const result = JSON.parse((await s.deps.kv.get(`event-test:${s.request.id}:announcement`))!);
    expect(result).toMatchObject({ ok: true, count: calls.length });
    expect(JSON.stringify(result)).not.toContain(STAFF_TOKEN);
    loadAll.mockRestore();
    ensure.mockRestore();
  });

  it("keeps the error for the UI and does not resend on a 5xx", async () => {
    const s = await testWorld();
    await testSend(s.db, s.manager, s.request.id, "announcement", s.deps.queue("deliver"));
    const calls = stubFetch([ok("t1"), status(500)]);
    const job = s.deps.queues.deliver.jobs.find((j) => j.jobName === "events.test")!;
    await runJob("deliver", "events.test", job.data, s.deps);
    expect(calls).toHaveLength(2);
    const result = JSON.parse((await s.deps.kv.get(`event-test:${s.request.id}:announcement`))!);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("staff");
    expect(JSON.stringify(result)).not.toContain(STAFF_TOKEN);
  });
});

describe("disaster and resolve", () => {
  async function disasterWorld() {
    const w = await postWorld({ status: "event_week" });
    const deps = testDeps(w.db);
    const run = (name: string, data: unknown) => runJob("deliver", name, data, deps);
    const postedDisaster = async () => {
      await postDisaster(w.db, w.manager, w.request.id, {}, deps.queue("deliver"));
      const [row] = await w.db.select().from(eventPost).where(eq(eventPost.kind, "disaster"));
      stubFetch([ok("d1")]);
      await run("events.post", { postId: row.id, attempt: row.attempt });
      return row.id;
    };
    const row = async (id: string) => (await w.db.select().from(eventPost).where(eq(eventPost.id, id)))[0];
    const lastPost = () => deps.queues.deliver.jobs.filter((j) => j.jobName === "events.post").at(-1)!;
    return { ...w, deps, run, postedDisaster, row, lastPost };
  }

  it("posts one embed from the template with every placeholder filled, no content and no ping", async () => {
    const s = await disasterWorld();
    await updateEventSettings(s.db, s.manager, { rulebookUrl: "https://example.com/regeln", disasterTemplate: { title: "{event} pausiert", text: "{date} {time} {duration} {where} {docs} {rules} [{note}]", color: "#c23636", imageUploadId: null } });
    await s.db.update(eventRequest).set({ eventDocsUrl: "https://example.com/docs" }).where(eq(eventRequest.id, s.request.id));
    await postDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    const [row] = await s.db.select().from(eventPost);
    expect(row).toMatchObject({ kind: "disaster", status: "sending", pingRole: false });
    const calls = stubFetch([ok("d1")]);
    await s.run("events.post", { postId: row.id, attempt: row.attempt });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${PUBLIC_URL}?wait=true`);
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(calls[0].body.content).toBeUndefined();
    const embed = (calls[0].body.embeds as { title: string; description: string }[])[0];
    expect(embed.title).toBe("Fixture event pausiert");
    expect(embed.description).toContain("Hafenwelt");
    expect(embed.description).toContain("https://example.com/docs");
    expect(embed.description).toContain("https://example.com/regeln");
    expect(embed.description).toContain("1 Stunde 30 Minuten");
    expect(embed.description).toMatch(/<t:\d+:t>/);
    expect(embed.description).toContain("[]");
    expect(embed.description).not.toMatch(/\{(date|time|duration|where|docs|rules|event)\}/);
    expect((await s.row(row.id)).status).toBe("posted");
  });

  it("sends the template image as an attachment", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "post-uploads-"));
    vi.stubEnv("EVENT_UPLOADS_DIR", dir);
    const s = await disasterWorld();
    await s.db.insert(eventUpload).values({ id: "upd", requestId: null, uploaderId: s.manager.userId, purpose: "template", originalName: "d.png", mime: "image/png", bytes: 3, storageKey: "0123abcd-dddd.png" });
    await writeFile(path.join(dir, "0123abcd-dddd.png"), new Uint8Array([137, 80, 78]));
    await updateEventSettings(s.db, s.manager, { disasterTemplate: { title: "Pause", text: "Text", color: "#c23636", imageUploadId: "upd" } });
    await postDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    const [row] = await s.db.select().from(eventPost);
    const calls = stubFetch([ok("d1")]);
    await s.run("events.post", { postId: row.id, attempt: row.attempt });
    expect(calls[0].multipart).toBe(true);
    expect((calls[0].body.embeds as { thumbnail: { url: string } }[])[0].thumbnail.url).toBe("attachment://image.png");
  });

  it("posts the disaster note inside the embed", async () => {
    const s = await disasterWorld();
    await postDisaster(s.db, s.manager, s.request.id, { note: "Der Server startet neu." }, s.deps.queue("deliver"));
    const [row] = await s.db.select().from(eventPost);
    const calls = stubFetch([ok("d1")]);
    await s.run("events.post", { postId: row.id, attempt: row.attempt });
    expect((calls[0].body.embeds as { description: string }[])[0].description).toContain("Der Server startet neu.");
    expect((calls[0].body.embeds as { description: string }[])[0].description).not.toContain("{note}");
  });

  it("resolves as a new message: the disaster message is neither patched nor deleted, and no back-online text follows", async () => {
    const s = await disasterWorld();
    const id = await s.postedDisaster();
    await resolveDisaster(s.db, s.manager, s.request.id, { note: "Der Server ist neu gestartet." }, s.deps.queue("deliver"));
    const job = s.lastPost();
    const calls = stubFetch([ok("r1")]);
    await s.run("events.post", job.data);
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    expect(calls[0].url).toBe(`${PUBLIC_URL}?wait=true`);
    expect(calls[0].body.content).toBeUndefined();
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
    const embed = (calls[0].body.embeds as { title: string; description: string }[])[0];
    expect(embed.title).toBe("Das Event ist nun wieder online");
    expect(embed.description).toContain("Der Server ist neu gestartet.");
    const disaster = await s.row(id);
    expect(disaster.status).toBe("posted");
    expect(disaster.resolvedAt).not.toBeNull();
    expect(disaster.parts.map((p) => p.messageId)).toEqual(["d1"]);
    const resolved = await s.row((job.data as { postId: string }).postId);
    expect(resolved).toMatchObject({ kind: "resolved", status: "posted" });
    expect(resolved.parts.map((p) => p.messageId)).toEqual(["r1"]);
    await expect(resolveDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"))).rejects.toThrow(/posted disaster/i);
    await postDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    expect(await s.db.select().from(eventPost)).toHaveLength(3);
  });

  it("does not let a deleted disaster block a new one", async () => {
    const s = await disasterWorld();
    const id = await s.postedDisaster();
    await deletePost(s.db, s.manager, s.request.id, "disaster", s.deps.queue("deliver"));
    stubFetch([ok("d1")]);
    await s.run("events.delete", s.deps.queues.deliver.jobs.filter((j) => j.jobName === "events.delete").at(-1)!.data);
    expect((await s.row(id)).status).toBe("deleted");
    await postDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    expect((await s.db.select().from(eventPost)).map((p) => p.status).sort()).toEqual(["deleted", "sending"]);
  });

  it("collapses an empty note cleanly", async () => {
    const s = await disasterWorld();
    await s.postedDisaster();
    await resolveDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    const calls = stubFetch([ok("r1")]);
    await s.run("events.post", s.lastPost().data);
    expect((calls[0].body.embeds as { description: string }[])[0].description).toBe("Fixture event läuft wieder.");
  });

  it("resumes a resolved message that stopped halfway like any post, without a second resolved message", async () => {
    const s = await disasterWorld();
    await s.postedDisaster();
    await resolveDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    const resolvedId = (s.lastPost().data as { postId: string }).postId;
    stubFetch([status(500)]);
    await expect(s.run("events.post", s.lastPost().data)).rejects.toThrow();
    expect((await s.row(resolvedId)).status).toBe("partial");
    await resumePost(s.db, s.manager, s.request.id, "resolved", s.deps.queue("deliver"));
    const calls = stubFetch([ok("r1")]);
    await s.run("events.post", s.lastPost().data);
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    expect(await s.db.select().from(eventPost).where(eq(eventPost.kind, "resolved"))).toHaveLength(1);
    expect((await s.row(resolvedId)).parts.map((p) => p.messageId)).toEqual(["r1"]);
  });

  it("deletes a resolved message without keeping a draft", async () => {
    const s = await disasterWorld();
    await s.postedDisaster();
    await resolveDisaster(s.db, s.manager, s.request.id, {}, s.deps.queue("deliver"));
    stubFetch([ok("r1")]);
    await s.run("events.post", s.lastPost().data);
    await deletePost(s.db, s.manager, s.request.id, "resolved", s.deps.queue("deliver"));
    stubFetch([ok("r1")]);
    await s.run("events.delete", s.deps.queues.deliver.jobs.filter((j) => j.jobName === "events.delete").at(-1)!.data);
    expect((await s.db.select().from(eventPost)).map((p) => `${p.kind}:${p.status}`).sort()).toEqual(["disaster:posted", "resolved:deleted"]);
  });
});
