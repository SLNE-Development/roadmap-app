import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { board, changeLog, projectWebhook } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { memoryQueue } from "@/lib/queue";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { createProject } from "./projects";
import { createWebhook, deleteWebhook, listWebhooks, sendTestMessage, updateWebhook } from "./webhooks";

const URL = "https://discord.com/api/webhooks/123456789/tok-en_abcd";
const URL_MESSAGE = "Use a Discord webhook URL from Channel settings → Integrations → Webhooks.";

describe("webhooks", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function setup() {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const [main] = await db.select().from(board).where(eq(board.projectId, projectId));
    const input = { name: "#roadmap-surf", url: URL, events: ["system.done" as const], boardIds: [], digest: false, timeZone: "UTC" };
    return { db, owner, slug, projectId, boardId: main.id, input };
  }

  it("refuses an editor", async () => {
    const { db, owner, slug, input } = await setup();
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await expect(createWebhook(db, editor, slug, input)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("refuses a URL that is not a Discord webhook", async () => {
    const { db, owner, slug, input } = await setup();
    await expect(createWebhook(db, owner, slug, { ...input, url: "https://example.com/hook" })).rejects.toMatchObject({
      name: "InvalidError",
      message: URL_MESSAGE,
    });
  });

  it("refuses a board of another project", async () => {
    const { db, owner, slug, input } = await setup();
    const other = await createProject(db, owner, { slug: "other", name: "Other" });
    const [foreign] = await db.select().from(board).where(eq(board.projectId, other.id));
    await expect(createWebhook(db, owner, slug, { ...input, boardIds: [foreign.id] })).rejects.toMatchObject({ name: "InvalidError" });
  });

  it("stores the URL encrypted and lists only its hint", async () => {
    const { db, owner, slug, input, boardId } = await setup();
    const { id } = await createWebhook(db, owner, slug, { ...input, boardIds: [boardId] });
    const list = await listWebhooks(db, owner, slug);
    expect(list).toMatchObject([{ id, name: "#roadmap-surf", urlHint: "abcd", events: ["system.done"], boardIds: [boardId], enabled: true }]);
    expect(JSON.stringify(list)).not.toContain("discord.com");
    expect(list[0]).not.toHaveProperty("urlEnc");
    const [row] = await db.select().from(projectWebhook).where(eq(projectWebhook.id, id));
    expect(row.urlEnc).not.toContain("discord.com");
    expect(decryptSecret(row.urlEnc)).toBe(URL);
  });

  it("logs changes without the URL", async () => {
    const { db, owner, slug, input, boardId } = await setup();
    const { id } = await createWebhook(db, owner, slug, input);
    await updateWebhook(db, owner, slug, id, {
      url: "https://discord.com/api/webhooks/1/other-token",
      events: ["system.done", "adr.accepted"],
      boardIds: [boardId],
      enabled: false,
    });
    await deleteWebhook(db, owner, slug, id);
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, "webhook"));
    expect(log.map((l) => [l.field, l.oldValue, l.newValue])).toEqual([
      ["created", null, "#roadmap-surf"],
      ["events", "system.done", "system.done, adr.accepted"],
      ["boards", "All boards", "Development"],
      ["enabled", "true", "false"],
      ["deleted", "#roadmap-surf", null],
    ]);
    expect(JSON.stringify(log)).not.toContain("discord.com");
    expect(await listWebhooks(db, owner, slug)).toEqual([]);
  });

  it("replaces the URL, keeps omitted fields and clears the disabled reason when enabled again", async () => {
    const { db, owner, slug, input, boardId } = await setup();
    const { id } = await createWebhook(db, owner, slug, { ...input, boardIds: [boardId], digest: true, timeZone: "Europe/Berlin" });
    await db.update(projectWebhook).set({ enabled: false, disabledReason: "Discord no longer accepts this webhook (404)." }).where(eq(projectWebhook.id, id));
    await updateWebhook(db, owner, slug, id, { url: "https://discord.com/api/webhooks/1/new-wxyz", enabled: true });
    const [row] = await db.select().from(projectWebhook).where(eq(projectWebhook.id, id));
    expect(row).toMatchObject({ enabled: true, disabledReason: null, urlHint: "wxyz", boardIds: [boardId], digest: true, timeZone: "Europe/Berlin", events: ["system.done"] });
    expect(decryptSecret(row.urlEnc)).toBe("https://discord.com/api/webhooks/1/new-wxyz");
  });

  it("refuses an unknown webhook and one of another project", async () => {
    const { db, owner, slug, input } = await setup();
    await createProject(db, owner, { slug: "other", name: "Other" });
    const { id } = await createWebhook(db, owner, "other", input);
    await expect(deleteWebhook(db, owner, slug, id)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(updateWebhook(db, owner, slug, "nope", { enabled: false })).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("enqueues one test message per webhook and minute", async () => {
    const { db, owner, slug, input } = await setup();
    const { id } = await createWebhook(db, owner, slug, input);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T10:00:05Z"));
    const queue = memoryQueue();
    await sendTestMessage(db, owner, slug, id, queue);
    vi.setSystemTime(new Date("2026-10-01T10:00:40Z"));
    await sendTestMessage(db, owner, slug, id, queue);
    expect(queue.jobs).toEqual([
      { jobName: "discord.test", data: { webhookId: id }, opts: { jobId: `discord-test-${id}-${Math.floor(Date.parse("2026-10-01T10:00:05Z") / 60_000)}` } },
    ]);
  });

  it("reports a clear error when the job queue is unreachable", async () => {
    const { db, owner, slug, input } = await setup();
    const { id } = await createWebhook(db, owner, slug, input);
    const down = { add: () => Promise.reject(new Error("Connection is closed.")) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendTestMessage(db, owner, slug, id, down)).rejects.toMatchObject({ name: "ConflictError" });
  });
});
