import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, eventUpload, project, projectMember, requestLog } from "@/db/schema";
import { newId } from "@/lib/id";
import { memoryQueue } from "@/lib/queue";
import { createProjectFixture } from "@/test/fixtures";
import { postWorld, stubEncryptionKey } from "@/test/post-fixtures";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { setEventSecrets, updateEventSettings } from "./event-settings";
import { cancelPreview, deleteChoices, deleteRequest, reopenRequest } from "./request-lifecycle";
import { cancelRequest, getRequest } from "./requests";
import { storeUpload } from "./uploads";

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

describe("deleteRequest", () => {
  const png = Uint8Array.from({ length: 64 }, (_, i) => (i < 4 ? [0x89, 0x50, 0x4e, 0x47][i] : i));
  const exists = async (w: World) => (await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id))).length === 1;

  /** A world whose request has a project, created from the event or only linked; the manager is its owner or an editor. */
  async function withProject(status: "cancelled" | "draft", opts: { created?: boolean; managerRole?: "owner" | "editor" } = {}) {
    const w = await postWorld({ status });
    const p = await createProjectFixture(w.db, "winter");
    await w.db.insert(projectMember).values({ projectId: p.projectId, userId: w.manager.userId, role: opts.managerRole ?? "owner" });
    await w.db.update(eventRequest).set({ projectId: p.projectId, projectCreated: opts.created ?? true }).where(eq(eventRequest.id, w.request.id));
    return { ...w, p };
  }

  it("deletes a cancelled request for a manager with its upload rows and files", async () => {
    const w = await postWorld({ status: "cancelled" });
    const dir = await mkdtemp(path.join(tmpdir(), "del-"));
    try {
      await storeUpload(w.db, w.manager, { requestId: w.request.id, purpose: "banner", name: "a.png", bytes: png }, dir);
      expect(await readdir(dir)).toHaveLength(1);
      await deleteRequest(w.db, w.manager, w.request.id, {}, undefined, dir);
      expect(await exists(w)).toBe(false);
      expect(await w.db.select().from(eventUpload)).toHaveLength(0);
      expect(await readdir(dir)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses accepted, event_week and done requests", async () => {
    for (const status of ["accepted", "event_week", "done"] as const) {
      const w = await postWorld({ status });
      await expect(deleteRequest(w.db, w.manager, w.request.id, {})).rejects.toThrow(new ConflictError("Only drafts, submitted, withdrawn and cancelled events can be deleted."));
      expect(await exists(w)).toBe(true);
    }
  });

  it("lets the requester delete their own draft and withdrawn request, not a submitted one, and hides it from strangers", async () => {
    const draft = await postWorld({ status: "draft" });
    await expect(deleteRequest(draft.db, draft.stranger, draft.request.id, {})).rejects.toBeInstanceOf(NotFoundError);
    await deleteRequest(draft.db, draft.requester, draft.request.id, {});
    expect(await exists(draft)).toBe(false);
    const withdrawn = await postWorld({ status: "withdrawn" });
    await deleteRequest(withdrawn.db, withdrawn.requester, withdrawn.request.id, {});
    expect(await exists(withdrawn)).toBe(false);
    const submitted = await postWorld({ status: "submitted" });
    await expect(deleteRequest(submitted.db, submitted.requester, submitted.request.id, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(await exists(submitted)).toBe(true);
    await deleteRequest(submitted.db, submitted.manager, submitted.request.id, {});
    expect(await exists(submitted)).toBe(false);
  });

  it("deletes a created project for its owner", async () => {
    const w = await withProject("cancelled");
    await deleteRequest(w.db, w.manager, w.request.id, { project: "delete" });
    expect(await exists(w)).toBe(false);
    expect(await w.db.select().from(project).where(eq(project.slug, "winter"))).toHaveLength(0);
  });

  it("refuses to delete or archive the project for a manager who is not its owner and keeps the request", async () => {
    const w = await withProject("cancelled", { managerRole: "editor" });
    await expect(deleteRequest(w.db, w.manager, w.request.id, { project: "delete" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteRequest(w.db, w.manager, w.request.id, { project: "archive" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await exists(w)).toBe(true);
    expect(await w.db.select().from(project).where(eq(project.slug, "winter"))).toHaveLength(1);
  });

  it("archives a created project, and keeps it on keep", async () => {
    const w = await withProject("cancelled");
    await deleteRequest(w.db, w.manager, w.request.id, { project: "archive" });
    expect((await w.db.select().from(project).where(eq(project.slug, "winter")))[0].archivedAt).not.toBeNull();
    const k = await withProject("cancelled");
    await deleteRequest(k.db, k.manager, k.request.id, {});
    expect((await k.db.select().from(project).where(eq(project.slug, "winter")))[0].archivedAt).toBeNull();
  });

  it("refuses to archive or delete a linked project and keeps the request", async () => {
    const w = await withProject("cancelled", { created: false });
    for (const choice of ["archive", "delete"] as const) {
      await expect(deleteRequest(w.db, w.manager, w.request.id, { project: choice })).rejects.toThrow(new InvalidError("Only a project created from this event can be archived or deleted here."));
    }
    expect(await exists(w)).toBe(true);
    await deleteRequest(w.db, w.manager, w.request.id, {});
    expect(await w.db.select().from(project).where(eq(project.slug, "winter"))).toHaveLength(1);
  });

  it("queues one delete-orphan job with the ids when the request has a Discord event and the bot is set", async () => {
    const w = await postWorld({ status: "cancelled" });
    await updateEventSettings(w.db, w.manager, { guildId: "42" });
    await setEventSecrets(w.db, w.admin, { botToken: BOT_TOKEN });
    await w.db.update(eventRequest).set({ discordEventId: "555" }).where(eq(eventRequest.id, w.request.id));
    const queue = memoryQueue();
    await deleteRequest(w.db, w.manager, w.request.id, {}, queue);
    expect(queue.jobs.map((j) => [j.jobName, j.data])).toEqual([["events.discord-event", { requestId: w.request.id, action: "delete-orphan", guildId: "42", eventId: "555" }]]);
    const noBot = await postWorld({ status: "cancelled" });
    await noBot.db.update(eventRequest).set({ discordEventId: "555" }).where(eq(eventRequest.id, noBot.request.id));
    const none = memoryQueue();
    await deleteRequest(noBot.db, noBot.manager, noBot.request.id, {}, none);
    expect(none.jobs).toHaveLength(0);
  });

  it("reports canDelete on the request detail", async () => {
    const w = await postWorld({ status: "draft" });
    expect((await getRequest(w.db, w.requester, w.request.id)).canDelete).toBe(true);
    expect((await getRequest(w.db, w.manager, w.request.id)).canDelete).toBe(true);
    const s = await postWorld({ status: "submitted" });
    expect((await getRequest(s.db, s.requester, s.request.id)).canDelete).toBe(false);
    const a = await postWorld();
    expect((await getRequest(a.db, a.manager, a.request.id)).canDelete).toBe(false);
  });
});

describe("deleteChoices", () => {
  it("reports the created project and the rights of the actor", async () => {
    const w = await postWorld({ status: "cancelled" });
    const p = await createProjectFixture(w.db, "winter");
    await w.db.insert(projectMember).values({ projectId: p.projectId, userId: w.manager.userId, role: "editor" });
    await w.db.update(eventRequest).set({ projectId: p.projectId, projectCreated: true }).where(eq(eventRequest.id, w.request.id));
    expect(await deleteChoices(w.db, w.manager, w.request.id)).toEqual({ allowed: true, reason: null, project: { slug: "winter", name: "WINTER", created: true, canArchive: false, canDelete: false, archived: false } });
    expect((await deleteChoices(w.db, w.admin, w.request.id)).project).toMatchObject({ canArchive: true, canDelete: true });
    await w.db.update(projectMember).set({ role: "owner" }).where(eq(projectMember.userId, w.manager.userId));
    expect((await deleteChoices(w.db, w.manager, w.request.id)).project).toMatchObject({ canArchive: true, canDelete: true });
  });

  it("says why a request cannot be deleted and reports no project without one", async () => {
    const w = await postWorld();
    expect(await deleteChoices(w.db, w.manager, w.request.id)).toEqual({ allowed: false, reason: "Only drafts, submitted, withdrawn and cancelled events can be deleted.", project: null });
    const s = await postWorld({ status: "submitted" });
    expect(await deleteChoices(s.db, s.requester, s.request.id)).toMatchObject({ allowed: false });
  });
});
