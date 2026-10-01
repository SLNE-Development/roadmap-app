import { describe, expect, it } from "vitest";
import { githubDelivery } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import type { GitHubEventJob } from "@/lib/github/webhook";
import { createTestDb } from "@/test/db";
import { testDeps } from "../deps";
import { registeredJobs, registeredRepeatables } from "../jobs";
import { handleGitHubEvent, onGitHubEvent } from "./events";
import { pruneDeliveries } from "./prune";

const NOW = new Date("2026-10-01T12:00:00Z");
const api = fakeGitHubApi();
const getApi = async () => api;

async function delivery(db: Db, deliveryId: string, event: string, receivedAt = NOW): Promise<GitHubEventJob> {
  await db.insert(githubDelivery).values({ deliveryId, source: "app", event, receivedAt });
  return { deliveryId, event, source: "app", repoId: null, payload: {} };
}

const statusOf = async (db: Db) => (await db.select().from(githubDelivery)).map((d) => [d.status, d.detail]);

onGitHubEvent("test_done", async () => ({ status: "skipped", detail: "nothing to do" }));
onGitHubEvent("test_throws", async () => {
  throw new Error("x".repeat(600));
});

describe("handleGitHubEvent", () => {
  it("is registered with the prune job", () => {
    expect(registeredJobs()).toContainEqual({ queue: "github", jobName: "github.event" });
    expect(registeredRepeatables()).toContainEqual(
      expect.objectContaining({ queue: "maintenance", jobName: "github.prune-deliveries", schedule: { cron: "15 4 * * *", tz: "UTC" } }),
    );
  });

  it("marks an event without a handler ignored", async () => {
    const db = await createTestDb();
    await handleGitHubEvent(await delivery(db, "d1", "star"), testDeps(db), getApi);
    expect(await statusOf(db)).toEqual([["ignored", null]]);
  });

  it("stores the handler's outcome", async () => {
    const db = await createTestDb();
    await handleGitHubEvent(await delivery(db, "d1", "test_done"), testDeps(db), getApi);
    expect(await statusOf(db)).toEqual([["skipped", "nothing to do"]]);
  });

  it("marks a failing delivery failed with a cut message and rethrows", async () => {
    const db = await createTestDb();
    await expect(handleGitHubEvent(await delivery(db, "d1", "test_throws"), testDeps(db), getApi)).rejects.toThrow("xxx");
    expect(await statusOf(db)).toEqual([["failed", "x".repeat(500)]]);
  });
});

describe("pruneDeliveries", () => {
  it("deletes deliveries older than 30 days", async () => {
    const db = await createTestDb();
    await delivery(db, "old", "push", new Date(NOW.getTime() - 31 * 86_400_000));
    await delivery(db, "fresh", "push", new Date(NOW.getTime() - 29 * 86_400_000));
    expect(await pruneDeliveries(testDeps(db, { now: () => NOW }))).toBe(1);
    expect((await db.select().from(githubDelivery)).map((d) => d.deliveryId)).toEqual(["fresh"]);
  });
});
