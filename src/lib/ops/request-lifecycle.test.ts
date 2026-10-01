import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, requestLog } from "@/db/schema";
import { newId } from "@/lib/id";
import { memoryQueue } from "@/lib/queue";
import { postWorld, stubEncryptionKey } from "@/test/post-fixtures";
import { ConflictError, ForbiddenError, InvalidError } from "./errors";
import { setEventSecrets, updateEventSettings } from "./event-settings";
import { cancelPreview, reopenRequest } from "./request-lifecycle";
import { cancelRequest } from "./requests";

beforeEach(stubEncryptionKey);
afterEach(() => vi.unstubAllEnvs());

const BOT_TOKEN = "B".repeat(60);

type World = Awaited<ReturnType<typeof postWorld>>;

/** Stores an announcement post of the world's request; `sent` gives its message a Discord id. */
async function announcement(w: World, sent: boolean) {
  const part = { kind: "embed" as const, content: "", messageId: sent ? "m1" : null, sentAt: sent ? "2026-10-01T00:00:00.000Z" : null };
  await w.db.insert(eventPost).values({ id: newId(), requestId: w.request.id, kind: "announcement", status: sent ? "posted" : "failed", text: "Hallo", parts: [part], createdBy: w.manager.userId });
}

const posts = (w: World, kind: "cancelled" | "announcement") => w.db.select().from(eventPost).where(eq(eventPost.requestId, w.request.id)).then((rows) => rows.filter((r) => r.kind === kind));
const reload = async (w: World) => (await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id)))[0];

describe("cancelRequest", () => {
  it("posts one cancelled message when the announcement is in Discord, with the reason as note, and queues the event delete", async () => {
    const w = await postWorld();
    await announcement(w, true);
    await updateEventSettings(w.db, w.manager, { guildId: "42" });
    await setEventSecrets(w.db, w.admin, { botToken: BOT_TOKEN });
    await w.db.update(eventRequest).set({ discordEventId: "555" }).where(eq(eventRequest.id, w.request.id));
    const queue = memoryQueue();
    const cancelled = await cancelRequest(w.db, w.manager, w.request.id, { reason: "Sturm" }, queue);
    expect(cancelled).toMatchObject({ status: "cancelled", cancelNote: "Sturm" });
    const [post] = await posts(w, "cancelled");
    expect(post).toMatchObject({ kind: "cancelled", note: "Sturm", status: "sending", attempt: 1, pingRole: false });
    expect(post.parts.map((p) => p.kind)).toEqual(["embed"]);
    expect(post.parts[0].embed?.description).toContain("Sturm");
    expect(queue.jobs.map((j) => [j.jobName, j.data])).toEqual([
      ["events.post", { postId: post.id, attempt: 1 }],
      ["events.discord-event", { requestId: w.request.id, action: "delete" }],
    ]);
  });

  it("posts nothing when the announcement was never posted", async () => {
    const w = await postWorld();
    await announcement(w, false);
    const queue = memoryQueue();
    await cancelRequest(w.db, w.manager, w.request.id, { reason: "Sturm" }, queue);
    expect(await posts(w, "cancelled")).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
    expect((await reload(w)).status).toBe("cancelled");
  });

  it("cancels without a message when the public webhook is not set", async () => {
    const w = await postWorld({ webhooks: false });
    await announcement(w, true);
    const queue = memoryQueue();
    expect((await cancelRequest(w.db, w.manager, w.request.id, { reason: "Sturm" }, queue)).status).toBe("cancelled");
    expect(await posts(w, "cancelled")).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("refuses a reason over 1,000 characters and a missing one", async () => {
    const w = await postWorld();
    await expect(cancelRequest(w.db, w.manager, w.request.id, { reason: "a".repeat(1001) })).rejects.toBeInstanceOf(InvalidError);
    await expect(cancelRequest(w.db, w.manager, w.request.id, { reason: "  " })).rejects.toBeInstanceOf(InvalidError);
    expect((await reload(w)).status).toBe("accepted");
    expect((await cancelRequest(w.db, w.manager, w.request.id, { reason: "a".repeat(1000) })).cancelNote).toHaveLength(1000);
  });

  it("never creates a second cancelled message when it is called again", async () => {
    const w = await postWorld();
    await announcement(w, true);
    const queue = memoryQueue();
    await cancelRequest(w.db, w.manager, w.request.id, { reason: "Sturm" }, queue);
    await expect(cancelRequest(w.db, w.manager, w.request.id, { reason: "Nochmal" }, queue)).rejects.toBeInstanceOf(ConflictError);
    expect(await posts(w, "cancelled")).toHaveLength(1);
    expect(queue.jobs.filter((j) => j.jobName === "events.post")).toHaveLength(1);
    expect((await reload(w)).cancelNote).toBe("Sturm");
  });

  it("keeps the reason in the log", async () => {
    const w = await postWorld();
    await cancelRequest(w.db, w.manager, w.request.id, { reason: "Sturm" });
    const rows = await w.db.select().from(requestLog).where(eq(requestLog.requestId, w.request.id));
    expect(rows.find((r) => r.field === "status")).toMatchObject({ oldValue: "accepted", newValue: "Sturm" });
  });
});

describe("cancelPreview", () => {
  it("says a message is posted, with the embed and the literal {note}", async () => {
    const w = await postWorld();
    await announcement(w, true);
    const preview = await cancelPreview(w.db, w.manager, w.request.id);
    expect(preview).toMatchObject({ willPost: true, reason: "posted" });
    expect(preview.embed?.description).toContain("{note}");
  });

  it("says nothing is posted without a posted announcement", async () => {
    const w = await postWorld();
    await announcement(w, false);
    expect(await cancelPreview(w.db, w.manager, w.request.id)).toEqual({ willPost: false, reason: "not-posted", embed: null });
  });

  it("warns about a missing public webhook", async () => {
    const w = await postWorld({ webhooks: false });
    await announcement(w, true);
    expect(await cancelPreview(w.db, w.manager, w.request.id)).toEqual({ willPost: false, reason: "no-webhook", embed: null });
  });

  it("is for managers and developers only", async () => {
    const w = await postWorld();
    await expect(cancelPreview(w.db, w.requester, w.request.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reopenRequest", () => {
  async function cancelled(opts: { posted?: boolean; bot?: boolean } = {}) {
    const w = await postWorld();
    if (opts.posted !== false) await announcement(w, true);
    if (opts.bot !== false) {
      await updateEventSettings(w.db, w.manager, { guildId: "42" });
      await setEventSecrets(w.db, w.admin, { botToken: BOT_TOKEN });
    }
    await cancelRequest(w.db, w.manager, w.request.id, { reason: "Sturm" });
    return w;
  }

  it("reopens a cancelled request as accepted, clears the note, logs it and queues the Discord event create", async () => {
    const w = await cancelled();
    const queue = memoryQueue();
    const reopened = await reopenRequest(w.db, w.manager, w.request.id, queue);
    expect(reopened).toMatchObject({ status: "accepted", cancelNote: null });
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({ jobName: "events.discord-event", data: { requestId: w.request.id, action: "create" }, opts: { jobId: `event-dev-${w.request.id}-create-${reopened.updatedAt.getTime()}` } });
    const rows = await w.db.select().from(requestLog).where(eq(requestLog.requestId, w.request.id));
    expect(rows.at(-1)).toMatchObject({ field: "status", oldValue: "cancelled", newValue: "accepted" });
  });

  it("queues nothing without a posted announcement or without the bot", async () => {
    const unposted = await cancelled({ posted: false });
    const q1 = memoryQueue();
    await reopenRequest(unposted.db, unposted.manager, unposted.request.id, q1);
    expect(q1.jobs).toHaveLength(0);
    const noBot = await cancelled({ bot: false });
    const q2 = memoryQueue();
    expect((await reopenRequest(noBot.db, noBot.manager, noBot.request.id, q2)).status).toBe("accepted");
    expect(q2.jobs).toHaveLength(0);
  });

  it("is forbidden for a requester without manage or develop access", async () => {
    const w = await cancelled();
    await expect(reopenRequest(w.db, w.requester, w.request.id, memoryQueue())).rejects.toBeInstanceOf(ForbiddenError);
    expect((await reload(w)).status).toBe("cancelled");
  });

  it("reopens a withdrawn request as a draft for its requester", async () => {
    const w = await postWorld({ status: "withdrawn" });
    await expect(reopenRequest(w.db, w.stranger, w.request.id)).rejects.toThrow();
    expect((await reopenRequest(w.db, w.requester, w.request.id)).status).toBe("draft");
  });

  it("refuses a status that cannot be reopened", async () => {
    const w = await postWorld({ status: "done" });
    await expect(reopenRequest(w.db, w.manager, w.request.id)).rejects.toBeInstanceOf(ConflictError);
    const open = await postWorld();
    await expect(reopenRequest(open.db, open.manager, open.request.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
