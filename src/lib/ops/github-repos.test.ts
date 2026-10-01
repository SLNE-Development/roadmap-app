import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLog, codeLink, githubInstallation, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { memoryKv, type Kv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { addMemberFixture, insertUser } from "@/test/fixtures";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError } from "./errors";
import { saveAppCredentials, setLinkPolicy } from "./github-app";
import { availableRepos, linkAppRepo, linkManualRepo, listLinkedRepos, revealRepoSecret, setRepoRules, unlinkRepo } from "./github-repos";
import { setMember } from "./members";
import { createProject } from "./projects";
import { createSystem } from "./systems";

const appInput = {
  appId: 42,
  slug: "roadmap-app",
  name: "Roadmap App",
  ownerLogin: "Org",
  htmlUrl: "https://github.com/apps/roadmap-app",
  clientId: "Iv1.abc",
  clientSecret: "client-secret",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  webhookSecret: "whsec",
};

interface World {
  db: Db;
  kv: Kv;
  api: ReturnType<typeof fakeGitHubApi>;
  admin: Actor;
  o: Actor;
  o2: Actor;
}

/** Installation 11 sees `Org/a` and `Org/b`; O owns project P, O2 owns project Q without O. */
async function setup(): Promise<World> {
  const db = await createTestDb();
  const admin = await insertUser(db, { name: "Admin", isAdmin: true });
  await saveAppCredentials(db, admin, appInput);
  await db.insert(githubInstallation).values({ id: 11, accountLogin: "Org", accountType: "Organization", repositorySelection: "selected" });
  const o = await insertUser(db, { name: "O" });
  const o2 = await insertUser(db, { name: "O2" });
  await createProject(db, o, { slug: "p", name: "P" });
  await createProject(db, o2, { slug: "q", name: "Q" });
  const api = fakeGitHubApi({
    repos: {
      11: [
        { id: 2, fullName: "Org/b", ownerLogin: "Org", private: false },
        { id: 1, fullName: "Org/a", ownerLogin: "Org", private: true },
      ],
    },
  });
  return { db, kv: memoryKv(), api, admin, o, o2 };
}

describe("github repos", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("BETTER_AUTH_URL", "https://roadmap.example.test");
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lists the repos the App can see, sorted, none linked", async () => {
    const { db, kv, api, o } = await setup();
    const repos = await availableRepos(db, kv, api, o, "p");
    expect(repos.map((r) => [r.fullName, r.linked])).toEqual([
      ["Org/a", null],
      ["Org/b", null],
    ]);
    expect(repos[0]).toMatchObject({ ownerLogin: "Org", private: true, installationId: 11, githubRepoId: 1 });
  });

  it("hides the name of a project the actor cannot see", async () => {
    const { db, kv, api, o, o2 } = await setup();
    await linkAppRepo(db, kv, api, o2, "q", { fullName: "Org/b" });
    const forO = await availableRepos(db, kv, api, o, "p");
    expect(forO.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: false, projectName: null });
    const adminMember = await insertUser(db, { name: "Admin member", isAdmin: true });
    await setMember(db, o2, "q", { userId: adminMember.userId, role: "viewer" });
    const forAdmin = await availableRepos(db, kv, api, adminMember, "p");
    expect(forAdmin.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: false, projectName: "Q" });
    const forO2 = await availableRepos(db, kv, api, o2, "q");
    expect(forO2.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: true });
  });

  it("refuses a repo linked to another project, naming only the repo", async () => {
    const { db, kv, api, o, o2 } = await setup();
    await linkAppRepo(db, kv, api, o2, "q", { fullName: "Org/b" });
    const error = await linkAppRepo(db, kv, api, o, "p", { fullName: "Org/b" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toBe("Org/b is already linked to another project.");
  });

  it("refuses a repo the App cannot see", async () => {
    const { db, kv, api, o } = await setup();
    await expect(linkAppRepo(db, kv, api, o, "p", { fullName: "Org/zzz" })).rejects.toThrow(InvalidError);
    await expect(linkAppRepo(db, kv, api, o, "p", { fullName: "Org/zzz" })).rejects.toThrow("can't see");
  });

  it("lets only owners and admins link", async () => {
    const { db, kv, api, o, admin } = await setup();
    const editor = await addMemberFixture(db, o, "p", "editor");
    const refused = new ForbiddenError("Only admins can link repositories on this instance.");
    await expect(linkAppRepo(db, kv, api, editor, "p", { fullName: "Org/a" })).rejects.toThrow(refused);
    await setLinkPolicy(db, admin, "admins");
    await expect(linkAppRepo(db, kv, api, o, "p", { fullName: "Org/a" })).rejects.toThrow(refused);
    const repo = await linkAppRepo(db, kv, api, admin, "p", { fullName: "Org/a" });
    expect(repo).toMatchObject({ fullName: "Org/a", mode: "app", access: "ok", private: true, createdByName: "Admin" });
    const [row] = await db.select().from(githubRepo);
    expect(row).toMatchObject({ installationId: 11, githubRepoId: 1, fullNameKey: "org/a" });
    const log = await db.select().from(changeLog);
    expect(log.filter((l) => l.entity === "repo").map((l) => [l.field, l.newValue])).toEqual([["created", "Org/a"]]);
  });

  it("links a repo by hand with an encrypted secret it can reveal again", async () => {
    const { db, o } = await setup();
    const { repo, webhookUrl, secret } = await linkManualRepo(db, o, "p", { fullName: "partner/docs" });
    expect(webhookUrl).toBe(`https://roadmap.example.test/api/github/hooks/${repo.id}`);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await db.select().from(githubRepo);
    expect(row.mode).toBe("webhook");
    expect(row.webhookSecretEnc).toBeTruthy();
    expect(row.webhookSecretEnc).not.toContain(secret);
    expect(await revealRepoSecret(db, o, repo.id)).toEqual({ webhookUrl, secret });
    expect((await listLinkedRepos(db, o, "p")).map((r) => r.fullName)).toEqual(["partner/docs"]);
  });

  it("hints at the App for a repo it sees, and unlinks with a log entry", async () => {
    const { db, kv, api, o } = await setup();
    await availableRepos(db, kv, api, o, "p");
    const { repo, hint } = await linkManualRepo(db, o, "p", { fullName: "org/A" }, kv);
    expect(hint).toBe("The GitHub App can see this repository; linking it through the app also shows checks.");
    expect(repo.mode).toBe("webhook");
    await unlinkRepo(db, o, repo.id);
    expect(await db.select().from(githubRepo)).toEqual([]);
    const log = (await db.select().from(changeLog)).filter((l) => l.entity === "repo");
    expect(log.map((l) => [l.field, l.oldValue, l.newValue])).toEqual([
      ["created", null, "org/A"],
      ["deleted", "org/A", null],
    ]);
  });

  it("refuses a malformed repository name", async () => {
    const { db, o } = await setup();
    await expect(linkManualRepo(db, o, "p", { fullName: "not a repo" })).rejects.toThrow(InvalidError);
  });

  it("merges rule changes and logs them once", async () => {
    const { db, o } = await setup();
    const { repo } = await linkManualRepo(db, o, "p", { fullName: "partner/docs" });
    await setRepoRules(db, o, repo.id, { closeOnMerge: true });
    const [row] = await db.select().from(githubRepo);
    expect(row.rules).toEqual({ closeOnMerge: true, reviewOnOpen: false, checksWarning: false });
    const rules = (await db.select().from(changeLog)).filter((l) => l.entity === "repo" && l.field === "rules");
    expect(rules).toHaveLength(1);
    expect(JSON.parse(rules[0].newValue ?? "{}")).toEqual({ closeOnMerge: true, reviewOnOpen: false, checksWarning: false });
  });

  it("caches an installation's repos", async () => {
    const { db, kv, api, o } = await setup();
    await availableRepos(db, kv, api, o, "p");
    await availableRepos(db, kv, api, o, "p");
    expect(api.calls.filter((c) => c.method === "listInstallationRepos")).toHaveLength(1);
    const [inst] = await db.select().from(githubInstallation);
    expect(inst.repoCount).toBe(2);
  });

  it("lists and links the other installations' repos when one cannot be listed", async () => {
    const { db, kv, api, o } = await setup();
    await db.insert(githubInstallation).values({ id: 12, accountLogin: "Other", accountType: "Organization", repositorySelection: "all" });
    api.seed.repos[12] = [{ id: 3, fullName: "Other/x", ownerLogin: "Other", private: false }];
    const list = api.listInstallationRepos;
    api.listInstallationRepos = async (id) => {
      if (id === 11) throw new Error("installation 11 is gone");
      return list(id);
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await availableRepos(db, kv, api, o, "p")).map((r) => r.fullName)).toEqual(["Other/x"]);
    expect(error).toHaveBeenCalledWith(expect.any(String), 11, "installation 11 is gone");
    const linked = await linkAppRepo(db, kv, api, o, "p", { fullName: "Other/x" });
    expect(linked.fullName).toBe("Other/x");
  });

  it("asks GitHub when the cache misses a repo", async () => {
    const { db, kv, api, o } = await setup();
    await kv.set("gh:repos:11", JSON.stringify([{ id: 1, fullName: "Org/a", ownerLogin: "Org", private: true }]));
    api.seed.repos[11].push({ id: 5, fullName: "Org/c", ownerLogin: "Org", private: false });
    const linked = await linkAppRepo(db, kv, api, o, "p", { fullName: "Org/c" });
    expect(linked.fullName).toBe("Org/c");
    expect(api.calls.filter((c) => c.method === "listInstallationRepos")).toHaveLength(1);
  });

  it("does not fetch twice for an installation without a cache", async () => {
    const { db, kv, api, o } = await setup();
    await expect(linkAppRepo(db, kv, api, o, "p", { fullName: "Org/zzz" })).rejects.toThrow(InvalidError);
    expect(api.calls.filter((c) => c.method === "listInstallationRepos")).toHaveLength(1);
  });

  it("refuses to reveal a secret of a repo linked through the App", async () => {
    const { db, kv, api, o } = await setup();
    const repo = await linkAppRepo(db, kv, api, o, "p", { fullName: "Org/a" });
    await expect(revealRepoSecret(db, o, repo.id)).rejects.toThrow(InvalidError);
  });

  it("removes a repo's code links when it is unlinked", async () => {
    const { db, o } = await setup();
    const { repo } = await linkManualRepo(db, o, "p", { fullName: "partner/docs" });
    const sys = await createSystem(db, o, "p", { slug: "s", title: "S" });
    await db.insert(codeLink).values({
      id: "cl1",
      projectId: sys.projectId,
      systemId: sys.id,
      repoId: repo.id,
      kind: "pr",
      refKey: "pr:1",
      targetKey: `system:${sys.id}`,
      number: 1,
      title: "t",
      url: "https://github.com/partner/docs/pull/1",
      state: "open",
    });
    await unlinkRepo(db, o, repo.id);
    expect(await db.select().from(codeLink)).toEqual([]);
  });
});
