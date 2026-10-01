import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { githubDelivery, githubInstallation, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { memoryKv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { handleGitHubEvent } from "./events";
import "./installations";

const api = fakeGitHubApi();
const getApi = async () => api;
const installation = { id: 11, account: { login: "Org", type: "Organization" }, repository_selection: "selected" };

let seq = 0;

/** Runs one App delivery through the registered handler and returns its stored status. */
async function deliver(db: Db, deps: ReturnType<typeof testDeps>, event: string, payload: unknown): Promise<string | undefined> {
  seq += 1;
  const deliveryId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await db.insert(githubDelivery).values({ deliveryId, source: "app", event });
  await handleGitHubEvent({ deliveryId, event, source: "app", repoId: null, payload }, deps, getApi);
  const [row] = await db.select({ status: githubDelivery.status }).from(githubDelivery).where(eq(githubDelivery.deliveryId, deliveryId));
  return row?.status;
}

async function setup() {
  const db = await createTestDb();
  const kv = memoryKv();
  const deps = testDeps(db, { kv });
  const { projectId } = await createProjectFixture(db);
  return { db, kv, deps, projectId };
}

describe("installation events", () => {
  it("stores a created installation, then marks it removed and its repos lost when deleted", async () => {
    const { db, kv, deps, projectId } = await setup();
    await kv.set("gh:repos:11", "[]");
    expect(await deliver(db, deps, "installation", { action: "created", installation })).toBe("done");
    expect(await db.select().from(githubInstallation)).toEqual([
      expect.objectContaining({ id: 11, accountLogin: "Org", accountType: "Organization", repositorySelection: "selected", status: "active" }),
    ]);
    expect(await kv.get("gh:repos:11")).toBeNull();

    await db.insert(githubRepo).values({ id: "r1", projectId, fullName: "Org/a", fullNameKey: "org/a", mode: "app", installationId: 11, githubRepoId: 1 });
    await kv.set("gh:repos:11", "[]");
    expect(await deliver(db, deps, "installation", { action: "deleted", installation })).toBe("done");
    const [row] = await db.select().from(githubInstallation);
    expect(row.status).toBe("removed");
    const [repo] = await db.select().from(githubRepo);
    expect(repo.access).toBe("lost");
    expect(await kv.get("gh:repos:11")).toBeNull();
  });

  it("adopts the linked repos when the App is installed again with a new installation id", async () => {
    const { db, deps, projectId } = await setup();
    await deliver(db, deps, "installation", { action: "created", installation });
    await db.insert(githubRepo).values({ id: "r1", projectId, fullName: "Org/a", fullNameKey: "org/a", mode: "app", installationId: 11, githubRepoId: 1 });
    await deliver(db, deps, "installation", { action: "deleted", installation });
    expect((await db.select().from(githubRepo))[0].access).toBe("lost");

    const again = { ...installation, id: 12 };
    await deliver(db, deps, "installation", {
      action: "created",
      installation: again,
      repositories: [{ id: 1, full_name: "Org/A", private: true }, { id: 2, full_name: "Org/unlinked" }],
    });
    expect(await db.select().from(githubRepo)).toMatchObject([{ access: "ok", installationId: 12, githubRepoId: 1, mode: "app", private: true }]);
  });

  it("marks a suspended installation suspended", async () => {
    const { db, deps } = await setup();
    await deliver(db, deps, "installation", { action: "created", installation });
    await deliver(db, deps, "installation", { action: "suspend", installation });
    const [row] = await db.select().from(githubInstallation);
    expect(row.status).toBe("suspended");
  });

  it.each(["unsuspend", "new_permissions_accepted", "created"])("marks the installation active on %s", async (action) => {
    const { db, deps } = await setup();
    await deliver(db, deps, "installation", { action: "suspend", installation });
    await deliver(db, deps, "installation", { action, installation });
    const [row] = await db.select().from(githubInstallation);
    expect(row.status).toBe("active");
  });

  it("keeps the stored account when a payload carries none", async () => {
    const { db, deps } = await setup();
    await deliver(db, deps, "installation", { action: "created", installation });
    await deliver(db, deps, "installation", { action: "suspend", installation: { id: 11 } });
    const [row] = await db.select().from(githubInstallation);
    expect(row).toMatchObject({ accountLogin: "Org", accountType: "Organization", status: "suspended" });
  });
});

describe("installation_repositories events", () => {
  it("moves a linked webhook repo to the App when it is added, and marks removed repos lost", async () => {
    const { db, kv, deps, projectId } = await setup();
    await deliver(db, deps, "installation", { action: "created", installation });
    await db.update(githubInstallation).set({ repoCount: 4 });
    await db.insert(githubRepo).values([
      { id: "r1", projectId, fullName: "Org/Docs", fullNameKey: "org/docs", mode: "webhook", webhookSecretEnc: "enc" },
      { id: "r2", projectId, fullName: "Org/old", fullNameKey: "org/old", mode: "app", installationId: 11, githubRepoId: 7 },
    ]);
    await kv.set("gh:repos:11", "[]");
    const status = await deliver(db, deps, "installation_repositories", {
      action: "added",
      installation: { ...installation, repository_selection: "all" },
      repository_selection: "all",
      repositories_added: [{ id: 9, full_name: "Org/docs", private: true }],
      repositories_removed: [],
    });
    expect(status).toBe("done");
    const [docs] = await db.select().from(githubRepo).where(eq(githubRepo.id, "r1"));
    expect(docs).toMatchObject({ mode: "app", access: "ok", installationId: 11, githubRepoId: 9, webhookSecretEnc: null });
    const [inst] = await db.select().from(githubInstallation);
    expect(inst).toMatchObject({ repositorySelection: "all", repoCount: null });
    expect(await kv.get("gh:repos:11")).toBeNull();

    await kv.set("gh:repos:11", "[]");
    await deliver(db, deps, "installation_repositories", {
      action: "removed",
      installation,
      repository_selection: "selected",
      repositories_added: [],
      repositories_removed: [{ id: 7, full_name: "Org/old" }],
    });
    const [old] = await db.select().from(githubRepo).where(eq(githubRepo.id, "r2"));
    expect(old.access).toBe("lost");
    expect(await kv.get("gh:repos:11")).toBeNull();
  });
});
