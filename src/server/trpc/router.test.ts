import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { createCallerFactory } from "./init";
import { appRouter } from "./router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor` (or without a session). */
function caller(db: Db, actor: Actor | null) {
  return createCallerFactory(appRouter)({ db, actor });
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
});
