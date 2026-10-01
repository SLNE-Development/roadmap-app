import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, requestLog } from "@/db/schema";
import { memoryQueue } from "@/lib/queue";
import { draftPost, longText, postWorld, PUBLIC_TOKEN, stubEncryptionKey, TEAM_TOKEN } from "@/test/post-fixtures";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { listPosts, previewPost, resumePost, savePostDraft, startPost } from "./request-posts";

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

  it("refuses a text over 20,000 characters", async () => {
    const w = await postWorld();
    await expect(savePostDraft(w.db, w.manager, w.request.id, "announcement", { text: "a".repeat(20_001) })).rejects.toBeInstanceOf(InvalidError);
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
    expect(view.targets).toEqual({ team: true, public: true });
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
