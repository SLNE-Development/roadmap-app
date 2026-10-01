import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { allowedAccount, user } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { notify, type NotifyInput } from "@/lib/ops/notifications";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createCallerFactory } from "./init";
import { appRouter } from "./router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor` (or without a session). */
function caller(db: Db, actor: Actor | null) {
  return createCallerFactory(appRouter)({ db, actor, sessionId: null });
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
    const api = createCallerFactory(appRouter)({ db, actor: owner, sessionId: "sess-current" });
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

    it("hides the members from a non-member", async () => {
      const db = await createTestDb();
      const { slug } = await createProjectFixture(db);
      const stranger = await insertUser(db);
      await expect(caller(db, stranger).notifications.members({ project: slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
