import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLog, codeLink, githubAccount, githubApp, githubInstallation, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { memoryKv, type Kv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { addMemberFixture, insertUser } from "@/test/fixtures";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { saveAppCredentials, setLinkPolicy } from "./github-app";
import { availableRepos, linkAppRepo, linkManualRepo, listLinkedRepos, pickableRepos, revealRepoSecret, setRepoRules, unlinkRepo } from "./github-repos";
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

/** Links the actor to the GitHub account `login`. */
async function linkGitHub(db: Db, actor: Actor, login: string, githubId: number): Promise<void> {
  await db.insert(githubAccount).values({ userId: actor.userId, githubId, login });
}

interface World {
  db: Db;
  kv: Kv;
  api: ReturnType<typeof fakeGitHubApi>;
  admin: Actor;
  o: Actor;
  o2: Actor;
}

/**
 * Installation 11 sees the private `Org/a` and the public `Org/b`; O owns project P, O2 owns project Q without O.
 * Admin, O and O2 have linked GitHub accounts that can read `Org/a`.
 */
async function setup(): Promise<World> {
  const db = await createTestDb();
  const admin = await insertUser(db, { name: "Admin", isAdmin: true });
  await saveAppCredentials(db, admin, appInput);
  await db.insert(githubInstallation).values({ id: 11, accountLogin: "Org", accountType: "Organization", repositorySelection: "selected" });
  const o = await insertUser(db, { name: "O" });
  const o2 = await insertUser(db, { name: "O2" });
  await createProject(db, o, { slug: "p", name: "P" });
  await createProject(db, o2, { slug: "q", name: "Q" });
  await linkGitHub(db, admin, "admin", 901);
  await linkGitHub(db, o, "o", 902);
  await linkGitHub(db, o2, "o2", 903);
  const api = fakeGitHubApi({
    repos: {
      11: [
        { id: 2, fullName: "Org/b", ownerLogin: "Org", private: false },
        { id: 1, fullName: "Org/a", ownerLogin: "Org", private: true },
      ],
    },
    readers: { "Org/a": ["admin", "o", "o2"] },
    logins: { 901: "admin", 902: "o", 903: "o2" },
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
    const { repos } = await availableRepos(db, kv, api, o, "p");
    expect(repos.map((r) => [r.fullName, r.linked])).toEqual([
      ["Org/a", null],
      ["Org/b", null],
    ]);
    expect(repos[0]).toMatchObject({ ownerLogin: "Org", private: true, installationId: 11, githubRepoId: 1 });
  });

  it("hides the name of a project the actor cannot see", async () => {
    const { db, kv, api, o, o2 } = await setup();
    await linkAppRepo(db, kv, api, o2, "q", { fullName: "Org/b" });
    const forO = (await availableRepos(db, kv, api, o, "p")).repos;
    expect(forO.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: false, projectName: null });
    const adminMember = await insertUser(db, { name: "Admin member", isAdmin: true });
    await setMember(db, o2, "q", { userId: adminMember.userId, role: "viewer" });
    const forAdmin = (await availableRepos(db, kv, api, adminMember, "p")).repos;
    expect(forAdmin.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: false, projectName: "Q" });
    const forO2 = (await availableRepos(db, kv, api, o2, "q")).repos;
    expect(forO2.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: true });
  });

  it("lists the pickable repos for a form without a project, none linked here", async () => {
    const { db, kv, api, admin, o, o2 } = await setup();
    await linkAppRepo(db, kv, api, o2, "q", { fullName: "Org/b" });
    const forAdmin = await pickableRepos(db, kv, api, admin);
    expect(forAdmin.canLink).toBe(true);
    expect(forAdmin.repos.map((r) => [r.fullName, r.linked])).toEqual([
      ["Org/a", null],
      ["Org/b", { here: false, projectName: "Q" }],
    ]);
    const forO = await pickableRepos(db, kv, api, o);
    expect(forO.canLink).toBe(true);
    expect(forO.repos.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: false, projectName: null });
    const forO2 = await pickableRepos(db, kv, api, o2);
    expect(forO2.repos.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: false, projectName: "Q" });
  });

  it("marks the project's own repos as linked here when a project is given", async () => {
    const { db, kv, api, o, o2 } = await setup();
    await linkAppRepo(db, kv, api, o2, "q", { fullName: "Org/b" });
    const forQ = await pickableRepos(db, kv, api, o2, "q");
    expect(forQ.repos.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: true });
    await expect(pickableRepos(db, kv, api, o, "q")).rejects.toThrow(NotFoundError);
    const viewer = await addMemberFixture(db, o2, "q", "viewer");
    expect((await pickableRepos(db, kv, api, viewer, "q")).repos.find((r) => r.fullName === "Org/b")?.linked).toEqual({ here: true });
  });

  it("offers no pickable repos under the admins policy for a non-admin, or without an App", async () => {
    const { db, kv, api, admin, o } = await setup();
    await setLinkPolicy(db, admin, "admins");
    expect(await pickableRepos(db, kv, api, o)).toEqual({ canLink: false, repos: [], githubLinked: false });
    expect((await pickableRepos(db, kv, api, admin)).canLink).toBe(true);
    await db.delete(githubApp);
    expect(await pickableRepos(db, kv, api, admin)).toEqual({ canLink: false, repos: [], githubLinked: false });
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
    expect((await availableRepos(db, kv, api, o, "p")).repos.map((r) => r.fullName)).toEqual(["Other/x"]);
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

describe("github repos visible to the person", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("BETTER_AUTH_URL", "https://roadmap.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Installation 11 sees the public `org/pub` and the private `org/priv` and `org/hidden`; only alice reads `org/priv`. */
  async function visibility() {
    const w = await setup();
    w.api.seed.repos[11] = [
      { id: 21, fullName: "org/pub", ownerLogin: "org", private: false },
      { id: 22, fullName: "org/priv", ownerLogin: "org", private: true },
      { id: 23, fullName: "org/hidden", ownerLogin: "org", private: true },
    ];
    w.api.seed.readers = { "org/priv": ["alice"] };
    w.api.seed.logins = { ...w.api.seed.logins, 911: "alice", 912: "bob" };
    const alice = await addMemberFixture(w.db, w.o, "p", "owner", "Alice");
    await linkGitHub(w.db, alice, "alice", 911);
    const bob = await insertUser(w.db, { name: "Bob", isAdmin: true });
    await linkGitHub(w.db, bob, "bob", 912);
    const nobody = await insertUser(w.db, { name: "Nobody", isAdmin: true });
    return { ...w, alice, bob, nobody };
  }
  const names = (r: { repos: { fullName: string }[] }) => r.repos.map((x) => x.fullName);

  it("shows public repos and the private ones the linked account can read", async () => {
    const { db, kv, api, alice } = await visibility();
    const picker = await availableRepos(db, kv, api, alice, "p");
    expect(names(picker)).toEqual(["org/priv", "org/pub"]);
    expect(picker.githubLinked).toBe(true);
  });

  it("shows only public repos without a linked account", async () => {
    const { db, kv, api, nobody } = await visibility();
    const picker = await pickableRepos(db, kv, api, nobody);
    expect(names(picker)).toEqual(["org/pub"]);
    expect(picker.githubLinked).toBe(false);
    expect(api.calls.filter((c) => c.method === "canUserReadRepo")).toHaveLength(0);
  });

  it("filters admins like everyone else", async () => {
    const { db, kv, api, bob } = await visibility();
    const picker = await pickableRepos(db, kv, api, bob);
    expect(names(picker)).toEqual(["org/pub"]);
    expect(picker.githubLinked).toBe(true);
  });

  it("caches the answers within the TTL", async () => {
    const { db, kv, api, alice } = await visibility();
    await availableRepos(db, kv, api, alice, "p");
    const asked = api.calls.filter((c) => c.method === "canUserReadRepo").length;
    expect(asked).toBe(2);
    await availableRepos(db, kv, api, alice, "p");
    expect(api.calls.filter((c) => c.method === "canUserReadRepo")).toHaveLength(asked);
  });

  it("drops a private repo when GitHub fails, without throwing", async () => {
    const { db, kv, api, alice } = await visibility();
    api.seed.failWith = { canUserReadRepo: 500 };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(names(await availableRepos(db, kv, api, alice, "p"))).toEqual(["org/pub"]);
    expect(error).toHaveBeenCalled();
  });

  it("checks a renamed account by its current login and stores it", async () => {
    const { db, kv, api } = await visibility();
    const carol = await insertUser(db, { name: "Carol" });
    await linkGitHub(db, carol, "alice-old", 913);
    api.seed.logins = { ...api.seed.logins, 913: "alice" };
    expect(names(await pickableRepos(db, kv, api, carol))).toEqual(["org/priv", "org/pub"]);
    expect(api.calls.filter((c) => c.method === "canUserReadRepo").every((c) => c.args[2] === "alice")).toBe(true);
    const [row] = await db.select().from(githubAccount).where(eq(githubAccount.userId, carol.userId));
    expect(row.login).toBe("alice");
  });

  it("shows only public repos when the login cannot be resolved", async () => {
    const { db, kv, api, alice } = await visibility();
    api.seed.failWith = { loginOf: 500 };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const picker = await availableRepos(db, kv, api, alice, "p");
    expect(names(picker)).toEqual(["org/pub"]);
    expect(picker.githubLinked).toBe(true);
    expect(api.calls.filter((c) => c.method === "canUserReadRepo")).toHaveLength(0);
  });

  it("caches the resolved login within the TTL", async () => {
    const { db, kv, api, alice } = await visibility();
    await availableRepos(db, kv, api, alice, "p");
    await availableRepos(db, kv, api, alice, "p");
    expect(api.calls.filter((c) => c.method === "loginOf")).toHaveLength(1);
  });

  it("links only repos the person can see", async () => {
    const { db, kv, api, alice } = await visibility();
    await expect(linkAppRepo(db, kv, api, alice, "p", { fullName: "org/hidden" })).rejects.toThrow(InvalidError);
    await expect(linkAppRepo(db, kv, api, alice, "p", { fullName: "org/hidden" })).rejects.toThrow("can't see");
    expect((await linkAppRepo(db, kv, api, alice, "p", { fullName: "org/priv" })).fullName).toBe("org/priv");
  });
});
