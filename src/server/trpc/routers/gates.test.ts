import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { boardColumn, githubRepo, system } from "@/db/schema";
import type { Db } from "@/db/types";
import { memoryKv } from "@/lib/kv";
import type { Actor } from "@/lib/ops/actor";
import { writeSpec } from "@/lib/ops/documents";
import { createSystem } from "@/lib/ops/systems";
import { addTask } from "@/lib/ops/tasks";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createCallerFactory } from "../init";
import { appRouter } from "../router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor`. */
const caller = (db: Db, actor: Actor) => createCallerFactory(appRouter)({ db, actor, sessionId: null, kv: memoryKv() });

/** Puts a system straight into the named column of its board. */
async function place(db: Db, systemId: string, name: string) {
  const [column] = await db.select({ id: boardColumn.id }).from(boardColumn).where(eq(boardColumn.name, name));
  await db.update(system).set({ columnId: column.id }).where(eq(system.id, systemId));
}

describe("gates router", () => {
  it("evaluates the next gated column of every system on the board", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const api = caller(db, owner);
    await api.boards.setColumnRules({ project: slug, board: "development", column: "Review", rules: [{ rule: "spec-exists" }] });
    await api.boards.setColumnRules({ project: slug, board: "development", column: "Done", rules: [{ rule: "all-tasks-done" }, { rule: "no-open-questions" }] });
    const a = await createSystem(db, owner, slug, { slug: "alpha", title: "Alpha" });
    const b = await createSystem(db, owner, slug, { slug: "beta", title: "Beta" });
    await completePlanningFixture(db, a.id);
    await completePlanningFixture(db, b.id);
    await writeSpec(db, owner, slug, "alpha", { body: "# Spec" });
    const { id: taskId } = await addTask(db, owner, slug, "beta", { title: "Open" });
    await place(db, a.id, "Todo");
    await place(db, b.id, "Review");

    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect(await caller(db, viewer).gates.board({ project: slug, board: "development" })).toEqual({
      [a.id]: { column: "Review", met: 1, total: 1, unmet: [] },
      [b.id]: { column: "Done", met: 1, total: 2, unmet: [`1 open task (#${taskId})`] },
    });
  });

  it("hides the board from non-members", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = await insertUser(db);
    await expect(caller(db, stranger).gates.board({ project: slug, board: "development" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists the rules with their parameters", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const rules = await caller(db, owner).gates.rules({ project: slug });
    expect(rules).toContainEqual({ id: "all-tasks-done", label: "All tasks done" });
    expect(rules).toContainEqual({
      id: "update-within-days",
      label: "Progress update in the last 3 days",
      param: { min: 1, max: 60, default: 3, unit: "days" },
    });
  });

  it("hides the pull request rules until a repository is linked, then notes what they need", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const ids = async () => (await caller(db, owner).gates.rules({ project: slug })).map((r) => r.id);
    expect(await ids()).not.toContain("pr-open");
    await db.insert(githubRepo).values({ id: "r1", projectId, fullName: "Org/App", fullNameKey: "org/app", mode: "webhook" });
    const rules = await caller(db, owner).gates.rules({ project: slug });
    expect(rules).toContainEqual({ id: "pr-open", label: "An open or merged pull request", needsGithub: true, note: "needs a linked GitHub repository" });
    expect(rules.map((r) => r.id)).toContain("pr-merged");
  });

  it("keeps a rule the column already has in the list even without GitHub", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const rules = await caller(db, owner).gates.rules({ project: slug, include: ["pr-open"] });
    expect(rules.map((r) => r.id)).toContain("pr-open");
    expect(rules.map((r) => r.id)).not.toContain("pr-merged");
  });
});
