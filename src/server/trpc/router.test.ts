import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { allowedAccount, user } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { DEFAULT_NOTIFY_RULES, activeKey } from "@/lib/notify-rules-schema";
import { memoryKv, type Kv } from "@/lib/kv";
import { notify, type NotifyInput } from "@/lib/ops/notifications";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { createCallerFactory } from "./init";
import { appRouter } from "./router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor` (or without a session). */
function caller(db: Db, actor: Actor | null, kv: Kv = memoryKv()) {
  return createCallerFactory(appRouter)({ db, actor, sessionId: null, kv });
}

describe("appRouter", () => {
  it("rejects every procedure without a session", async () => {
    const db = await createTestDb();
    await expect(caller(db, null).projects.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Your session has ended. Sign in again.",
    });
  });

  it("runs ops as the signed-in actor", async () => {
    const db = await createTestDb();
    const owner = await insertUser(db);
    const api = caller(db, owner);
    expect(await api.projects.create({ slug: "demo", name: "Demo" })).toEqual({ slug: "demo" });
    await api.systems.create({ project: "demo", system: { slug: "login", title: "Login" } });
    expect((await api.systems.list({ project: "demo" })).map((s) => s.slug)).toEqual(["login"]);
    expect((await api.projects.cards())[0]).toMatchObject({ slug: "demo", summary: { systems: 1 } });
  });

  it("rejects out-of-range integers as bad requests", async () => {
    const db = await createTestDb();
    const owner = await insertUser(db);
    await expect(caller(db, owner).tasks.update({ id: 3e9, patch: { title: "x" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps op errors to tRPC codes with the op's message", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const stranger = await insertUser(db);
    await expect(caller(db, stranger).projects.get({ project: slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(db, owner).projects.create({ slug, name: "Again" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: `Project slug ${slug} is taken.`,
    });
    await expect(caller(db, owner).account.accounts()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only admins can manage accounts." });
  });

  it("rejects unknown preference keys and bad values as BAD_REQUEST", async () => {
    const db = await createTestDb();
    const owner = await insertUser(db);
    const api = caller(db, owner);
    await expect(api.prefs.set({ key: "nope.key", value: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unknown preference." });
    await expect(api.prefs.set({ key: "overview.panels", value: { order: "x" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reports invalid input as BAD_REQUEST with readable zod issues", async () => {
    const db = await createTestDb();
    const owner = await insertUser(db);
    const error = await caller(db, owner)
      .projects.create({ slug: "Bad Slug", name: "X" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^slug: /) });
  });

  it("names fields of nested inputs without their wrapper key, but keeps array paths", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const api = caller(db, owner);
    await expect(api.systems.create({ project: slug, system: { slug: "login", title: "" } })).rejects.toMatchObject({
      message: expect.stringMatching(/^title: /),
    });
    await expect(
      api.boards.setColumns({ project: slug, board: "development", columns: [{ name: "", category: "todo" }, { name: "Done", category: "done" }] }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/^columns\.0\.name: /) });
  });

  it("lets a viewer list agent runs and read the cost of a system", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await caller(db, owner).systems.create({ project: slug, system: { slug: "login", title: "Login" } });
    const api = caller(db, viewer);
    expect(await api.agents.runs({ project: slug, state: "live" })).toEqual([]);
    expect(await api.agents.systemCost({ project: slug, system: "login" })).toBeNull();
    await expect(api.agents.run({ project: slug, runId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists users to project owners only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await expect(caller(db, editor).account.users({ project: slug })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const users = await caller(db, owner).account.users({ project: slug });
    expect(users.map((u) => u.id)).toContain(editor.userId);
  });

  it("refuses to end the current session from the sessions list", async () => {
    const db = await createTestDb();
    const owner = await insertUser(db);
    const api = createCallerFactory(appRouter)({ db, actor: owner, sessionId: "sess-current", kv: memoryKv() });
    await expect(api.account.endSession({ id: "sess-current" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Use Sign out to end this session.",
    });
  });

  describe("notifications", () => {
    /** A mention notice for `userId` in the project. */
    const notice = (projectId: string, userId: string, sourceKey: string): NotifyInput => ({
      userId,
      projectId,
      kind: "mention",
      entity: "question",
      entityId: "q1",
      title: "Owner mentioned you",
      href: "/p/demo/questions",
      sourceKey,
    });

    it("counts a user's unread rows", async () => {
      const db = await createTestDb();
      const { owner, slug, projectId } = await createProjectFixture(db);
      const editor = await addMemberFixture(db, owner, slug, "editor");
      await notify(db, notice(projectId, editor.userId, "cl:1"));
      await notify(db, notice(projectId, editor.userId, "cl:2"));
      expect(await caller(db, editor).notifications.unread()).toBe(2);
    });

    it("leaves another user's row unread when marking it read", async () => {
      const db = await createTestDb();
      const { owner, slug, projectId } = await createProjectFixture(db);
      const editor = await addMemberFixture(db, owner, slug, "editor");
      await notify(db, notice(projectId, editor.userId, "cl:1"));
      const [row] = await caller(db, editor).notifications.list({});
      await caller(db, owner).notifications.markRead({ ids: [row.id] });
      expect(await caller(db, editor).notifications.unread()).toBe(1);
    });

    it("lists the members of a project to a viewer", async () => {
      const db = await createTestDb();
      const { owner, slug } = await createProjectFixture(db);
      const viewer = await addMemberFixture(db, owner, slug, "viewer");
      const members = await caller(db, viewer).notifications.members({ project: slug });
      expect(members).toEqual(
        expect.arrayContaining([
          { userId: owner.userId, name: owner.name, image: null },
          { userId: viewer.userId, name: viewer.name, image: null },
        ]),
      );
      expect(members).toHaveLength(2);
    });

    it("leaves out a member whose account was removed", async () => {
      const db = await createTestDb();
      const { owner, slug } = await createProjectFixture(db);
      const editor = await addMemberFixture(db, owner, slug, "editor");
      const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, editor.userId));
      await db.delete(allowedAccount).where(eq(allowedAccount.discordId, row.discordId!));
      expect((await caller(db, owner).notifications.members({ project: slug })).map((m) => m.userId)).toEqual([owner.userId]);
    });

    it("rejects rules with an unknown time zone", async () => {
      const db = await createTestDb();
      const user1 = await insertUser(db);
      const rules = { ...DEFAULT_NOTIFY_RULES, quiet: { ...DEFAULT_NOTIFY_RULES.quiet, timeZone: "Mars/Olympus" } };
      await expect(caller(db, user1).notifications.setRules(rules)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects rules with a malformed quiet hours time", async () => {
      const db = await createTestDb();
      const user1 = await insertUser(db);
      const rules = { ...DEFAULT_NOTIFY_RULES, quiet: { ...DEFAULT_NOTIFY_RULES.quiet, start: "25:00" } };
      await expect(caller(db, user1).notifications.setRules(rules)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("saves rules and reads them back", async () => {
      const db = await createTestDb();
      const user1 = await insertUser(db);
      const api = caller(db, user1);
      expect(await api.notifications.rules()).toEqual(DEFAULT_NOTIFY_RULES);
      const rules = {
        ...DEFAULT_NOTIFY_RULES,
        kinds: { ...DEFAULT_NOTIFY_RULES.kinds, mention: { inbox: true, push: false } },
        quiet: { enabled: true, start: "21:30", end: "07:15", timeZone: "Europe/Berlin" },
        skipPushWhileActive: false,
      };
      await api.notifications.setRules(rules);
      expect(await api.notifications.rules()).toEqual(rules);
    });

    it("merges rules from a client that knows other kinds over the saved ones", async () => {
      const db = await createTestDb();
      const user1 = await insertUser(db);
      const api = caller(db, user1);
      await api.notifications.setRules({ ...DEFAULT_NOTIFY_RULES, kinds: { ...DEFAULT_NOTIFY_RULES.kinds, "adr.proposed": { inbox: false, push: false } } });
      const known = Object.fromEntries(Object.entries(DEFAULT_NOTIFY_RULES.kinds).filter(([kind]) => kind !== "adr.proposed"));
      const stale = { kinds: { ...known,mention: { inbox: true, push: false }, "gone.kind": { inbox: true, push: true } }, quiet: DEFAULT_NOTIFY_RULES.quiet };
      await api.notifications.setRules(stale as Parameters<typeof api.notifications.setRules>[0]);
      expect(await api.notifications.rules()).toEqual({
        ...DEFAULT_NOTIFY_RULES,
        kinds: { ...DEFAULT_NOTIFY_RULES.kinds, mention: { inbox: true, push: false }, "adr.proposed": { inbox: false, push: false } },
      });
    });

    it("marks the user active on a heartbeat", async () => {
      const db = await createTestDb();
      const user1 = await insertUser(db);
      const kv = memoryKv();
      await caller(db, user1, kv).notifications.heartbeat();
      expect(await kv.get(activeKey(user1.userId))).toBe("1");
    });

    it("answers a heartbeat even when the key-value store is down", async () => {
      const db = await createTestDb();
      const user1 = await insertUser(db);
      const down: Kv = { ...memoryKv(), set: () => Promise.reject(new Error("down")) };
      await expect(caller(db, user1, down).notifications.heartbeat()).resolves.toBeUndefined();
    });

    it("hides the members from a non-member", async () => {
      const db = await createTestDb();
      const { slug } = await createProjectFixture(db);
      const stranger = await insertUser(db);
      await expect(caller(db, stranger).notifications.members({ project: slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("refuses every github procedure to a non-admin", async () => {
    const credentials = {
      appId: 42,
      slug: "roadmap-app",
      name: "Roadmap App",
      ownerLogin: "SLNE-Development",
      htmlUrl: "https://github.com/apps/roadmap-app",
      clientId: "Iv1.abc",
      clientSecret: "client-secret",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
      webhookSecret: "hook-secret",
    };
    const db = await createTestDb();
    const api = caller(db, await insertUser(db)).github;
    const calls = [
      () => api.app(),
      () => api.health(),
      () => api.installations(),
      () => api.installRequests(),
      () => api.startManifest({}),
      () => api.saveCredentials({ credentials }),
      () => api.startInstall({}),
      () => api.dismissRequest({ id: "x" }),
      () => api.rotateSecret(),
      () => api.setLinkPolicy({ policy: "admins" }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates, freezes and lists releases", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const api = caller(db, owner).releases;
    await api.create({ project: slug, release: { slug: "v1", name: "v1", targetDate: "2026-12-01" } });
    expect((await api.freeze({ project: slug, release: "v1" })).status).toBe("frozen");
    expect(await api.list({ project: slug })).toMatchObject([{ slug: "v1", status: "frozen", systemCount: 0 }]);
    expect((await api.get({ project: slug, release: "v1" })).release.slug).toBe("v1");
    await api.writeNote({ project: slug, release: "v1", body: "Notes" });
    expect(await api.note({ project: slug, release: "v1" })).toMatchObject({ version: 1, body: "Notes" });
  });

  describe("requests", () => {
    it("hides a request from a stranger, refuses creation to a non-manager and reports a brief conflict", async () => {
      const db = await createTestDb();
      const manager = await insertUser(db, { isEventManager: true });
      const stranger = await insertUser(db);
      const created = await caller(db, manager).requests.create({ title: "Party", brief: "Hello" });
      await expect(caller(db, stranger).requests.get({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller(db, stranger).requests.create({ title: "Party", brief: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const api = caller(db, manager).requests;
      await api.saveBrief({ id: created.id, body: "One", baseVersion: 1 });
      await expect(api.saveBrief({ id: created.id, body: "Two", baseVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await api.get({ id: created.id })).brief).toBe("One");
      expect(await api.list({})).toMatchObject([{ id: created.id, briefVersion: 2 }]);
    });

    it("limits asking to developers and answering to the requester, and hides rounds from strangers", async () => {
      const db = await createTestDb();
      const requester = await insertUser(db);
      const developer = await insertUser(db, { isEventDeveloper: true });
      const stranger = await insertUser(db);
      const request = await requestFixture(db, requester, { status: "submitted" });
      const questions = [{ type: "yesno" as const, text: "Voice chat?" }];
      await expect(caller(db, requester).requests.askRound({ id: request.id, questions })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(db, stranger).requests.askRound({ id: request.id, questions })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller(db, developer).requests.askRound({ id: request.id, questions: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const round = await caller(db, developer).requests.askRound({ id: request.id, questions });
      await expect(caller(db, developer).requests.answerQuestions({ id: request.id, answers: [{ questionId: round.questionIds[0], value: true }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(db, requester).requests.answerQuestions({ id: request.id, answers: [{ questionId: round.questionIds[0], value: "yes" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await caller(db, requester).requests.answerQuestions({ id: request.id, answers: [{ questionId: round.questionIds[0], value: false }] });
      await expect(caller(db, stranger).requests.rounds({ id: request.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await caller(db, developer).requests.rounds({ id: request.id }))[0].questions[0]).toMatchObject({ answer: false, notSure: false });
    });

    it("limits accepting to developers and shows progress counts to the requester only", async () => {
      const db = await createTestDb();
      const requester = await insertUser(db);
      const developer = await insertUser(db, { isEventDeveloper: true });
      const stranger = await insertUser(db);
      const request = await requestFixture(db, requester, { status: "submitted", title: "Party", startsAt: new Date(Date.now() + 86_400_000) });
      expect(await caller(db, requester).requests.progress({ id: request.id })).toBeNull();
      await expect(caller(db, requester).requests.accept({ id: request.id, mode: "create" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(db, stranger).requests.accept({ id: request.id, mode: "create" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller(db, requester).requests.linkable()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await caller(db, developer).requests.linkable()).toEqual([]);
      expect(await caller(db, developer).requests.accept({ id: request.id, mode: "create" })).toMatchObject({ projectSlug: "party", systemSlug: "event" });
      await expect(caller(db, developer).requests.accept({ id: request.id, mode: "create" })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await caller(db, requester).requests.progress({ id: request.id })).toEqual({ total: 0, done: 0, doing: 0, blocked: 0, todo: 0, percent: 0, archived: false });
      await expect(caller(db, stranger).requests.progress({ id: request.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await caller(db, developer).requests.forProject({ project: "party" })).toMatchObject({ id: request.id, canView: true });
      expect(await caller(db, requester).requests.get({ id: request.id })).toMatchObject({ canAccept: false, projectOpen: false });
      expect(await caller(db, developer).requests.get({ id: request.id })).toMatchObject({ canAccept: true, projectOpen: true });
    });
  });
});
