import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, eventSettings, eventTodo, eventUpload, requestLog } from "@/db/schema";
import { savePostDraft, startPost } from "@/lib/ops/request-posts";
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
  const calls: { url: string; body: Record<string, unknown>; multipart: boolean }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const multipart = init.body instanceof FormData;
    const raw = multipart ? ((init.body as FormData).get("payload_json") as string) : (init.body as string);
    calls.push({ url, body: JSON.parse(raw), multipart });
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

  it("re-queues once with a 5 s delay while another job holds the lock, then stops after 10 tries", async () => {
    const s = await started();
    const calls = stubFetch([]);
    await s.deps.kv.set(`event-post:${s.post.id}`, "1", 120);
    const before = s.deps.queues.deliver.jobs.length;
    await s.run();
    expect(calls).toHaveLength(0);
    const added = s.deps.queues.deliver.jobs.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ data: { postId: s.post.id, attempt: 1, busy: 1 }, opts: { delayMs: 5000, jobId: `event-post-${s.post.id}-1-b1` } });
    await expect(s.run({ postId: s.post.id, attempt: 1, busy: 10 })).rejects.toThrow(/lock/);
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
    expect((calls[1].body.embeds as { image: { url: string } }[])[0].image.url).toBe("attachment://image.png");

    await w.db.update(eventPost).set({ status: "sending", attempt: 2, parts: post.parts }).where(eq(eventPost.id, post.id));
    await w.db.update(eventUpload).set({ storageKey: "0123abcd-9999.png" });
    const again = stubFetch([ok("n1"), ok("n2")]);
    await runJob("deliver", "events.post", { postId: post.id, attempt: 2 }, deps);
    expect(again[1].multipart).toBe(false);
    expect((again[1].body.embeds as { image?: unknown }[])[0].image).toBeUndefined();
    expect((await w.db.select().from(eventPost))[0].status).toBe("posted");
  });
});
