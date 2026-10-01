import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, requestLog } from "@/db/schema";
import { memoryKv } from "@/lib/kv";
import { memoryQueue } from "@/lib/queue";
import { setEventSecrets } from "./event-settings";
import { draftPost, longText, postWorld, PUBLIC_TOKEN, stubEncryptionKey, TEAM_TOKEN } from "@/test/post-fixtures";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { deletePost, editPost, listPosts, postDisaster, previewPost, resolveDisaster, resumePost, savePostDraft, startPost, testResult, testSend } from "./request-posts";

beforeEach(stubEncryptionKey);
afterEach(() => vi.unstubAllEnvs());

describe("savePostDraft", () => {
  it("refuses the role ping on a team notice", async () => {
    const w = await postWorld();
    await expect(savePostDraft(w.db, w.manager, w.request.id, "team", { text: "Hallo", pingRole: true })).rejects.toBeInstanceOf(InvalidError);
  });

  it("hides the request from a stranger", async () => {
    const w = await postWorld();
    await expect(savePostDraft(w.db, w.stranger, w.request.id, "announcement", { text: "Hallo" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("upserts the one post of a kind", async () => {
    const w = await postWorld();
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Eins" });
    await savePostDraft(w.db, w.requester, w.request.id, "announcement", { text: "Zwei", pingRole: true });
    const rows = await w.db.select().from(eventPost).where(eq(eventPost.requestId, w.request.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "Zwei", pingRole: true, status: "draft", attempt: 0 });
  });

  it("refuses a text over 40,000 characters", async () => {
    const w = await postWorld();
    await expect(savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "a".repeat(40_001) })).rejects.toBeInstanceOf(InvalidError);
  });

  it("refuses an edit once the post is sending, partial or posted", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Eins" });
    for (const status of ["sending", "partial", "posted"] as const) {
      await w.db.update(eventPost).set({ status }).where(eq(eventPost.id, post.id));
      await expect(savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Zwei" })).rejects.toBeInstanceOf(ConflictError);
    }
  });
});

describe("a post with sent messages", () => {
  it("cannot be edited even when failed", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    await w.db.update(eventPost).set({ status: "failed", parts: [{ ...row.parts[0], messageId: "1", sentAt: "x" }, ...row.parts.slice(1)] }).where(eq(eventPost.id, post.id));
    await expect(savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Neu" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps the card last on resume even when the new plan is shorter than the sent parts", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: longText(3900) });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    const sent = row.parts.slice(0, 2).map((p) => ({ ...p, messageId: "9", sentAt: "x" }));
    await w.db.update(eventPost).set({ status: "partial", text: "Kurz", parts: [...sent, row.parts[2]] }).where(eq(eventPost.id, post.id));
    await resumePost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    const [after] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    expect(after.parts.slice(0, 2)).toEqual(sent);
    expect(after.parts.at(-1)?.kind).toBe("embed");
    expect(after.parts.at(-1)?.messageId).toBeNull();
  });
});

describe("previewPost", () => {
  it("lists the planned messages with their lengths and no secret", async () => {
    const w = await postWorld();
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: longText(3900) });
    const preview = await previewPost(w.db, w.requester, w.request.id, "announcement");
    expect(preview.parts.map((p) => p.kind)).toEqual(["text", "text", "embed"]);
    expect(preview.parts[0].length).toBeLessThanOrEqual(2000);
    const json = JSON.stringify(preview);
    expect(json).not.toContain(TEAM_TOKEN);
    expect(json).not.toContain(PUBLIC_TOKEN);
  });

  it("is empty without a saved post", async () => {
    const w = await postWorld();
    expect((await previewPost(w.db, w.manager, w.request.id, "reminder")).parts).toEqual([]);
  });
});

describe("startPost", () => {
  it("needs the webhook of the target and names it exactly", async () => {
    const w = await postWorld({ webhooks: false });
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    const queue = memoryQueue();
    await expect(startPost(w.db, w.manager, w.request.id, "announcement", queue)).rejects.toThrow(new ConflictError("The public webhook is not set. An admin sets it in Event settings."));
    expect(queue.jobs).toHaveLength(0);
  });

  it("refuses a request that is still a draft", async () => {
    const w = await postWorld({ status: "draft" });
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await expect(startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
  });

  it("needs a text for an announcement and a saved draft", async () => {
    const w = await postWorld();
    await expect(startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(InvalidError);
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "   " });
    await expect(startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(InvalidError);
  });

  it("stores the planned parts, sets sending and enqueues one job; a second click conflicts", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: longText(3900), pingRole: true });
    const queue = memoryQueue();
    await startPost(w.db, w.manager, w.request.id, "announcement", queue);
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    expect(row).toMatchObject({ status: "sending", attempt: 1, postedBy: w.manager.userId });
    expect(row.parts.map((p) => p.kind)).toEqual(["text", "text", "embed"]);
    expect(row.parts.every((p) => p.messageId === null)).toBe(true);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.post", data: { postId: post.id, attempt: 1 }, opts: { jobId: `event-post-${post.id}-1`, attempts: 5, backoffMs: 5000 } });
    await expect(startPost(w.db, w.manager, w.request.id, "announcement", queue)).rejects.toBeInstanceOf(ConflictError);
    expect(queue.jobs).toHaveLength(1);
    const log = await w.db.select().from(requestLog).where(eq(requestLog.field, "post"));
    expect(log.map((l) => l.newValue)).toContain("announcement sending");
  });

  it("lets the requester of an open request post", async () => {
    const w = await postWorld();
    await savePostDraft(w.db, w.requester, w.request.id, "team", { text: "Team, bitte vorbereiten." });
    await startPost(w.db, w.requester, w.request.id, "team", memoryQueue());
    const [row] = await w.db.select().from(eventPost);
    expect(row.status).toBe("sending");
  });

  it("marks the post failed when the job cannot be queued, so it can be tried again", async () => {
    const w = await postWorld();
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    const broken = { add: async () => Promise.reject(new Error("valkey is down")) };
    await expect(startPost(w.db, w.manager, w.request.id, "announcement", broken)).rejects.toThrow("valkey is down");
    const [row] = await w.db.select().from(eventPost);
    expect(row.status).toBe("failed");
    const queue = memoryQueue();
    await startPost(w.db, w.manager, w.request.id, "announcement", queue);
    expect(queue.jobs).toHaveLength(1);
  });
});

describe("resumePost", () => {
  it("conflicts while a job is running and after posting", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    await expect(resumePost(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    await w.db.update(eventPost).set({ status: "posted" }).where(eq(eventPost.id, post.id));
    await expect(resumePost(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
  });

  it("re-plans only the unsent tail and keeps sent parts untouched", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: longText(3900), pingRole: true });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    const [started] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    const sent = { ...started.parts[0], messageId: "900", sentAt: "2026-10-01T10:00:00.000Z" };
    await w.db.update(eventPost).set({ status: "partial", parts: [sent, ...started.parts.slice(1)] }).where(eq(eventPost.id, post.id));
    // The text changes: the first paragraph (already posted) and the tail.
    await w.db.update(eventPost).set({ text: started.text.replace("Absatz 0", "GEAENDERT").replace(/Absatz 8 x+/, "Neuer Schluss") }).where(eq(eventPost.id, post.id));
    const queue = memoryQueue();
    await resumePost(w.db, w.manager, w.request.id, "announcement", queue);
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    expect(row.parts[0]).toEqual(sent);
    expect(row.parts[0].content).not.toContain("GEAENDERT");
    expect(row.parts.slice(1).every((p) => p.messageId === null)).toBe(true);
    expect(row.parts.at(-1)?.kind).toBe("embed");
    expect(row).toMatchObject({ status: "sending", attempt: 2 });
    expect(queue.jobs[0].opts.jobId).toBe(`event-post-${post.id}-2`);
  });

  it("refuses the webhook-less resume with the same message", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "team", { text: "Team" });
    await w.db.update(eventPost).set({ status: "failed" }).where(eq(eventPost.id, post.id));
    await w.db.update(eventRequest).set({ status: "cancelled" }).where(eq(eventRequest.id, w.request.id));
    await expect(resumePost(w.db, w.manager, w.request.id, "team", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("listPosts", () => {
  it("shows counts, the due date and marks an unposted announcement late once its date passed", async () => {
    const w = await postWorld();
    await w.db.update(eventRequest).set({ startsAt: new Date("2026-10-05T16:00:00Z") }).where(eq(eventRequest.id, w.request.id));
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await draftPost(w.db, w.manager, w.request.id, "team", { text: "Team" });
    const view = await listPosts(w.db, w.requester, w.request.id, new Date("2026-10-01T12:00:00Z"));
    const ann = view.posts.find((p) => p.kind === "announcement")!;
    expect(ann).toMatchObject({ id: post.id, status: "draft", partsCount: 0, sentCount: 0, late: true });
    expect(ann.dueAt?.toISOString()).toBe("2026-09-28T07:00:00.000Z");
    expect(view.posts.find((p) => p.kind === "team")?.late).toBe(true);
    expect(view.targets).toEqual({ team: true, public: true, staff: false });
    expect(view.dues.reminder.late).toBe(false);
    expect(view.dues.reminder.dueAt?.toISOString()).toBe("2026-10-04T07:00:00.000Z");
    expect(view.dues.announcement.late).toBe(true);
    await w.db.update(eventPost).set({ status: "posted", postedAt: new Date(), postedBy: w.manager.userId }).where(eq(eventPost.id, post.id));
    const after = await listPosts(w.db, w.requester, w.request.id, new Date("2026-10-01T12:00:00Z"));
    expect(after.posts.find((p) => p.kind === "announcement")).toMatchObject({ late: false, postedByName: "Manager" });
  });

  it("hides the request from a stranger", async () => {
    const w = await postWorld();
    await expect(listPosts(w.db, w.stranger, w.request.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

/** Puts a post of `kind` into `status` with message ids on every part, as if the worker had sent it. */
async function markPosted(w: Awaited<ReturnType<typeof postWorld>>, kind: "announcement" | "team" | "reminder", status: "posted" | "partial" | "failed" = "posted") {
  await startPost(w.db, w.manager, w.request.id, kind, memoryQueue());
  const [row] = await w.db.select().from(eventPost).where(eq(eventPost.kind, kind));
  const parts = row.parts.map((p, i) => ({ ...p, messageId: `m${i + 1}`, sentAt: "x" }));
  await w.db.update(eventPost).set({ status, parts }).where(eq(eventPost.id, row.id));
  return row.id;
}

describe("editPost", () => {
  it("stores the text, marks the post sending with a new attempt and edit version, and queues events.edit", async () => {
    const w = await postWorld();
    await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    const id = await markPosted(w, "announcement");
    const queue = memoryQueue();
    await editPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo Welt" }, queue);
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, id));
    expect(row).toMatchObject({ text: "Hallo Welt", status: "sending", attempt: 2, editVersion: 1 });
    expect(row.parts.map((p) => p.messageId)).toEqual(["m1", "m2"]);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.edit", data: { postId: id, editVersion: 1, attempt: 2 }, opts: { jobId: `event-edit-${id}-2`, attempts: 5 } });
  });

  it("refuses a draft, a post being sent and a disaster, and hides the request from a stranger", async () => {
    const w = await postWorld({ status: "event_week" });
    await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await expect(editPost(w.db, w.manager, w.request.id, "announcement", { text: "Neu" }, memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    await markPosted(w, "announcement");
    await expect(editPost(w.db, w.stranger, w.request.id, "announcement", { text: "Neu" }, memoryQueue())).rejects.toBeInstanceOf(NotFoundError);
    await editPost(w.db, w.manager, w.request.id, "announcement", { text: "Neu" }, memoryQueue());
    await expect(editPost(w.db, w.manager, w.request.id, "announcement", { text: "Noch neuer" }, memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    await postDisaster(w.db, w.manager, w.request.id, memoryQueue());
    await expect(editPost(w.db, w.manager, w.request.id, "disaster", { text: "x" }, memoryQueue())).rejects.toBeInstanceOf(InvalidError);
  });

  it("puts the post back when the queue is down", async () => {
    const w = await postWorld();
    await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    const id = await markPosted(w, "announcement");
    await expect(editPost(w.db, w.manager, w.request.id, "announcement", { text: "Neu" }, { add: async () => Promise.reject(new Error("down")) })).rejects.toThrow("down");
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, id));
    expect(row.status).toBe("posted");
    expect(row.lastError).toContain("could not be queued");
  });
});

describe("deletePost", () => {
  it("queues events.delete for a posted, partial or failed post with ids and refuses the rest", async () => {
    const w = await postWorld();
    await draftPost(w.db, w.manager, w.request.id, "team", { text: "Hallo" });
    await expect(deletePost(w.db, w.manager, w.request.id, "team", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    const id = await markPosted(w, "team", "failed");
    const queue = memoryQueue();
    await deletePost(w.db, w.manager, w.request.id, "team", queue);
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, id));
    expect(row.status).toBe("sending");
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.delete", data: { postId: id, attempt: row.attempt }, opts: { jobId: `event-delete-${id}-${row.attempt}` } });
    await expect(deletePost(w.db, w.manager, w.request.id, "team", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    await expect(deletePost(w.db, w.stranger, w.request.id, "team", memoryQueue())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("testSend", () => {
  it("needs the staff webhook, a saved draft and a kind that is not disaster or resolved", async () => {
    const w = await postWorld();
    await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await expect(testSend(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toThrow("The staff test webhook is not set. An admin sets it in Event settings.");
    await expect(testSend(w.db, w.manager, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    await setEventSecrets(w.db, w.admin, { staffWebhook: "https://discord.com/api/webhooks/333333333333333333/STAFF" });
    for (const kind of ["disaster", "resolved"] as const) await expect(testSend(w.db, w.manager, w.request.id, kind, memoryQueue())).rejects.toBeInstanceOf(InvalidError);
    await expect(testSend(w.db, w.manager, w.request.id, "reminder", memoryQueue())).rejects.toBeInstanceOf(InvalidError);
    await expect(testSend(w.db, w.stranger, w.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("queues one job for a double click, another for a retest after a draft change, and keeps the id free of colons", async () => {
    const w = await postWorld();
    await setEventSecrets(w.db, w.admin, { staffWebhook: "https://discord.com/api/webhooks/333333333333333333/STAFF" });
    await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    const queue = memoryQueue();
    await testSend(w.db, w.manager, w.request.id, "announcement", queue);
    await testSend(w.db, w.manager, w.request.id, "announcement", queue);
    expect(queue.jobs).toHaveLength(1);
    await savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "Hallo Welt" });
    await testSend(w.db, w.manager, w.request.id, "announcement", queue);
    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs.every((j) => !String(j.opts.jobId).includes(":"))).toBe(true);
  });

  it("queues the test job and the result key can be read", async () => {
    const w = await postWorld();
    await setEventSecrets(w.db, w.admin, { staffWebhook: "https://discord.com/api/webhooks/333333333333333333/STAFF" });
    await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    const queue = memoryQueue();
    await testSend(w.db, w.manager, w.request.id, "announcement", queue);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.test", data: { requestId: w.request.id, kind: "announcement", userId: w.manager.userId } });
    expect(queue.jobs[0].opts.jobId).toMatch(/^event-test-[^:]+-announcement-\d+-\d+$/);
    expect(queue.jobs[0].opts.attempts).toBe(1);
    const kv = memoryKv();
    expect(await testResult(kv, w.db, w.manager, w.request.id, "announcement")).toBeNull();
    await kv.set(`event-test:${w.request.id}:announcement`, JSON.stringify({ ok: true, count: 2, at: "2026-10-01T10:00:00.000Z" }), 60);
    expect(await testResult(kv, w.db, w.manager, w.request.id, "announcement")).toEqual({ ok: true, count: 2, at: "2026-10-01T10:00:00.000Z" });
    await expect(testResult(kv, w.db, w.stranger, w.request.id, "announcement")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("postDisaster and resolveDisaster", () => {
  it("needs the event week and the public webhook", async () => {
    const w = await postWorld();
    await expect(postDisaster(w.db, w.manager, w.request.id, memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    const open = await postWorld({ webhooks: false, status: "event_week" });
    await expect(postDisaster(open.db, open.manager, open.request.id, memoryQueue())).rejects.toThrow("The public webhook is not set. An admin sets it in Event settings.");
    await expect(postDisaster(open.db, open.stranger, open.request.id, memoryQueue())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates a sending disaster post that never pings and refuses a second one until it is resolved", async () => {
    const w = await postWorld({ status: "event_week" });
    const queue = memoryQueue();
    await postDisaster(w.db, w.manager, w.request.id, queue);
    const [row] = await w.db.select().from(eventPost);
    expect(row).toMatchObject({ kind: "disaster", status: "sending", attempt: 1, pingRole: false });
    expect(row.parts).toHaveLength(1);
    expect(row.parts[0]).toMatchObject({ kind: "embed", messageId: null });
    expect(row.parts[0].embed?.title).toBe("Wir arbeiten an einer Lösung");
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.post", data: { postId: row.id, attempt: 1 }, opts: { jobId: `event-post-${row.id}-1` } });
    await expect(postDisaster(w.db, w.manager, w.request.id, memoryQueue())).rejects.toThrow("A disaster message is already posted. Resolve it first.");
    await w.db.update(eventPost).set({ status: "failed" });
    await postDisaster(w.db, w.manager, w.request.id, memoryQueue());
    expect((await w.db.select().from(eventPost)).map((p) => p.status).sort()).toEqual(["deleted", "sending"]);
  });

  it("resolves only a posted disaster once and refuses a note over 500 characters", async () => {
    const w = await postWorld({ status: "event_week" });
    await expect(resolveDisaster(w.db, w.manager, w.request.id, {}, memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    await postDisaster(w.db, w.manager, w.request.id, memoryQueue());
    await expect(resolveDisaster(w.db, w.manager, w.request.id, {}, memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    const [row] = await w.db.select().from(eventPost);
    await w.db.update(eventPost).set({ status: "posted", parts: row.parts.map((p) => ({ ...p, messageId: "d1", sentAt: "x" })) });
    await expect(resolveDisaster(w.db, w.manager, w.request.id, { note: "x".repeat(501) }, memoryQueue())).rejects.toBeInstanceOf(InvalidError);
    const queue = memoryQueue();
    await resolveDisaster(w.db, w.manager, w.request.id, { note: "Fertig" }, queue);
    const [after] = await w.db.select().from(eventPost);
    expect(after).toMatchObject({ status: "sending", note: "Fertig", attempt: 2 });
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.resolve", data: { postId: row.id, attempt: 2 }, opts: { jobId: `event-resolve-${row.id}-2` } });
  });
});

describe("a post that lost its job", () => {
  const OLD = new Date(Date.now() - 10 * 60_000);

  /** A started announcement with one message sent, `sending` since `at`. */
  async function stuck(at: Date) {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: longText(3900) });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    const [row] = await w.db.select().from(eventPost).where(eq(eventPost.id, post.id));
    await w.db.update(eventPost).set({ parts: [{ ...row.parts[0], messageId: "1", sentAt: "x" }, ...row.parts.slice(1)], updatedAt: at }).where(eq(eventPost.id, post.id));
    return { ...w, post };
  }

  it("is resumed once the sending status is older than the lock, but not while it is fresh", async () => {
    const fresh = await stuck(new Date());
    await expect(resumePost(fresh.db, fresh.manager, fresh.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    const old = await stuck(OLD);
    const queue = memoryQueue();
    await resumePost(old.db, old.manager, old.request.id, "announcement", queue);
    const [row] = await old.db.select().from(eventPost).where(eq(eventPost.id, old.post.id));
    expect(row).toMatchObject({ status: "sending", attempt: 2 });
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.post", data: { postId: old.post.id, attempt: 2 } });
  });

  it("is deleted once stale, but not while fresh", async () => {
    const fresh = await stuck(new Date());
    await expect(deletePost(fresh.db, fresh.manager, fresh.request.id, "announcement", memoryQueue())).rejects.toBeInstanceOf(ConflictError);
    const old = await stuck(OLD);
    const queue = memoryQueue();
    await deletePost(old.db, old.manager, old.request.id, "announcement", queue);
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.delete" });
  });

  it("goes back to partial when the resume cannot be queued", async () => {
    const old = await stuck(OLD);
    const down = { ...memoryQueue(), add: async () => { throw new Error("down"); } };
    await expect(resumePost(old.db, old.manager, old.request.id, "announcement", down as never)).rejects.toThrow();
    const [row] = await old.db.select().from(eventPost).where(eq(eventPost.id, old.post.id));
    expect(row.status).toBe("partial");
  });

  it("lists the stale flag", async () => {
    const old = await stuck(OLD);
    expect((await listPosts(old.db, old.manager, old.request.id)).posts[0].stale).toBe(true);
    const fresh = await stuck(new Date());
    expect((await listPosts(fresh.db, fresh.manager, fresh.request.id)).posts[0].stale).toBe(false);
  });
});

describe("editing a partial post and starting disaster kinds", () => {
  it("refuses to edit a partial post of which no message is in Discord yet", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    await w.db.update(eventPost).set({ status: "partial" }).where(eq(eventPost.id, post.id));
    const queue = memoryQueue();
    await expect(editPost(w.db, w.manager, w.request.id, "announcement", { text: "Neu" }, queue)).rejects.toThrow("Nothing was posted yet; use Resume.");
    expect(queue.jobs).toHaveLength(0);
  });

  it("does not start a disaster or resolved post through startPost", async () => {
    const w = await postWorld({ status: "accepted" });
    for (const kind of ["disaster", "resolved"] as const) {
      await w.db.insert(eventPost).values({ id: `p-${kind}`, requestId: w.request.id, kind, text: "x" });
      await expect(startPost(w.db, w.manager, w.request.id, kind, memoryQueue())).rejects.toBeInstanceOf(InvalidError);
    }
    expect((await w.db.select().from(eventPost).where(eq(eventPost.kind, "disaster")))[0].status).toBe("draft");
  });
});
