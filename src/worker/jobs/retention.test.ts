import { describe, expect, it } from "vitest";
import { agentCall, agentRun, authEvent, discordOutbox, notification, projectWebhook } from "@/db/schema";
import type { Db } from "@/db/types";
import { createProjectFixture } from "@/test/fixtures";
import { createTestDb } from "@/test/db";
import { testDeps } from "../deps";
import { registeredRepeatables, runJob } from "../jobs";
import "./retention";
import { pruneTelemetry } from "./retention";

const NOW = new Date("2026-10-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function addRun(db: Db, userId: string, id: string, lastCallAt: Date) {
  await db.insert(agentRun).values({ id, apiKeyId: "key", userId, startedAt: lastCallAt, lastCallAt });
}

const call = (runId: string, at: Date) => ({
  runId,
  at,
  tool: "get_project",
  transport: "mcp" as const,
  ok: true,
  status: 200,
  durationMs: 5,
});

describe("pruneTelemetry", () => {
  it("removes calls and runs older than 30 days and keeps newer ones", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    await addRun(db, owner.userId, "old", daysAgo(31));
    await addRun(db, owner.userId, "fresh", daysAgo(29));
    await db.insert(agentCall).values([call("old", daysAgo(31)), call("fresh", daysAgo(31)), call("fresh", daysAgo(29))]);

    const result = await pruneTelemetry(testDeps(db, { now: () => NOW }));

    expect(result).toEqual({ calls: 2, runs: 1, events: 0, outbox: 0, notifications: 0 });
    expect((await db.select().from(agentRun)).map((r) => r.id)).toEqual(["fresh"]);
    expect(await db.select().from(agentCall)).toHaveLength(1);
  });

  it("removes auth events older than 90 days and keeps newer ones", async () => {
    const db = await createTestDb();
    await db.insert(authEvent).values([
      { kind: "sign-in", at: daysAgo(91) },
      { kind: "key-rejected", at: daysAgo(60) },
    ]);

    const result = await pruneTelemetry(testDeps(db, { now: () => NOW }));

    expect(result.events).toBe(1);
    expect((await db.select().from(authEvent)).map((e) => e.kind)).toEqual(["key-rejected"]);
  });

  it("removes Discord outbox rows sent more than 7 days ago and keeps newer and pending ones", async () => {
    const db = await createTestDb();
    const { projectId } = await createProjectFixture(db);
    await db.insert(projectWebhook).values({ id: "hook", projectId, name: "#roadmap", urlEnc: "v1.x.y.z", urlHint: "abcd", events: ["system.done"] });
    const row = (changeLogId: number, sentAt: Date | null) => ({ webhookId: "hook", changeLogId, payload: {}, createdAt: daysAgo(30), sentAt });
    await db.insert(discordOutbox).values([row(1, daysAgo(8)), row(2, daysAgo(6)), row(3, null)]);

    const result = await pruneTelemetry(testDeps(db, { now: () => NOW }));

    expect(result.outbox).toBe(1);
    expect((await db.select().from(discordOutbox)).map((r) => r.changeLogId).sort()).toEqual([2, 3]);
  });

  it("removes notifications read more than 90 days ago or created more than 180 days ago", async () => {
    const db = await createTestDb();
    const { owner, projectId } = await createProjectFixture(db);
    const row = (id: string, createdAt: Date, readAt: Date | null) => ({
      id,
      userId: owner.userId,
      projectId,
      kind: "mention" as const,
      entity: "question",
      entityId: "q1",
      title: "t",
      href: "/p/demo",
      sourceKey: id,
      createdAt,
      readAt,
    });
    await db.insert(notification).values([
      row("read-old", daysAgo(100), daysAgo(91)),
      row("read-recent", daysAgo(100), daysAgo(89)),
      row("unread-old", daysAgo(181), null),
      row("unread-recent", daysAgo(179), null),
    ]);

    const result = await pruneTelemetry(testDeps(db, { now: () => NOW }));

    expect(result.notifications).toBe(2);
    expect((await db.select().from(notification)).map((r) => r.id).sort()).toEqual(["read-recent", "unread-recent"]);
  });

  it("removes more than one batch of old calls", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    await addRun(db, owner.userId, "old", daysAgo(40));
    const old = daysAgo(31);
    for (let i = 0; i < 12; i++) {
      await db.insert(agentCall).values(Array.from({ length: 1000 }, () => call("old", old)));
    }

    const result = await pruneTelemetry(testDeps(db, { now: () => NOW }));

    expect(result.calls).toBe(12_000);
    expect(await db.select().from(agentCall)).toHaveLength(0);
  }, 60_000);

  it("is registered daily on the maintenance queue", async () => {
    expect(registeredRepeatables()).toContainEqual(
      expect.objectContaining({ queue: "maintenance", jobName: "prune-telemetry", schedule: { cron: "30 3 * * *", tz: "UTC" } }),
    );
    const db = await createTestDb();
    await runJob("maintenance", "prune-telemetry", {}, testDeps(db, { now: () => NOW }));
  });
});
