import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { allowedAccount, changeLog, user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { acceptAdr, createAdr } from "./adrs";
import { setSystemArchived } from "./archive";
import { removeMember, setMember } from "./members";
import { markMyWorkSeen, myWork } from "./my-work";
import { addPlanningRound } from "./planning";
import { addQuestion, answerQuestion } from "./questions";
import { createSystem, updateSystem } from "./systems";
import { addTask, updateTask } from "./tasks";

const adrBody = (title: string, systems: string[]) => ({ title, context: "c", decision: "d", alternatives: "a", consequences: "q", systems });

/** An owner, Alice as editor owning the system `api`, and a second project where Alice is a viewer. */
async function setup() {
  const db = await createTestDb();
  const { owner, slug } = await createProjectFixture(db);
  const alice = await addMemberFixture(db, owner, slug, "editor");
  const sys = await createSystem(db, owner, slug, { slug: "api", title: "API" });
  await updateSystem(db, owner, slug, "api", { ownerUserId: alice.userId });
  const other = await createProjectFixture(db, "other");
  await setMember(db, other.owner, "other", { userId: alice.userId, role: "viewer" });
  return { db, owner, alice, slug, sys, now: new Date() };
}

describe("myWork", () => {
  it("lists blocked tasks before doing ones", async () => {
    const { db, owner, alice, slug, sys, now } = await setup();
    await completePlanningFixture(db, sys.id);
    const doing = await addTask(db, owner, slug, "api", { title: "Doing" });
    const blocked = await addTask(db, owner, slug, "api", { title: "Blocked" });
    await updateTask(db, owner, doing.id, { state: "doing", ownerUserId: alice.userId });
    await updateTask(db, owner, blocked.id, { state: "blocked", blockedReason: "API key", ownerUserId: alice.userId });
    const items = (await myWork(db, alice, { now })).filter((i) => i.kind === "task");
    expect(items.map((i) => i.title)).toEqual([`#${blocked.id} Blocked`, `#${doing.id} Doing`]);
    expect(items[0]).toMatchObject({ section: "waiting", projectSlug: slug, systemSlug: "api", href: `/p/${slug}/systems/api` });
    expect(items[0].detail).toContain("blocked: API key");
    expect(items[1].detail).toBe("API · in progress");
  });

  it("lists open planning items of an owned system in planning", async () => {
    const { db, owner, alice, slug, now } = await setup();
    await addPlanningRound(db, owner, slug, "api", {
      items: [
        { area: "scope", question: "What?" },
        { area: "failure-modes", question: "Why?" },
      ],
    });
    const [item] = (await myWork(db, alice, { now })).filter((i) => i.kind === "planning");
    expect(item).toMatchObject({ title: "Planning round 1 has 2 open items", detail: "API", href: `/p/${slug}/systems/api?tab=planning` });
  });

  it("lists questions from others, not the actor's own, and answered ones the actor asked", async () => {
    const { db, owner, alice, slug, now } = await setup();
    await addQuestion(db, owner, slug, { title: "From owner", system: "api", priority: "blocking" });
    await addQuestion(db, alice, slug, { title: "Own", system: "api" });
    const asked = await addQuestion(db, alice, slug, { title: "Asked by Alice" });
    await answerQuestion(db, owner, slug, { id: asked.id, answer: "Yes", resolved: false });
    const items = (await myWork(db, alice, { now })).filter((i) => i.kind === "question");
    expect(items.map((i) => i.title)).toEqual(["From owner", "Asked by Alice"]);
    expect(items[0].href).toBe(`/p/${slug}/questions?system=api`);
    expect(items[1].detail).toBe("Answered, waiting for you to resolve");
    await markMyWorkSeen(db, alice, new Date(now.getTime() + 60_000));
    expect((await myWork(db, alice, { now })).filter((i) => i.title === "Asked by Alice")).toEqual([]);
  });

  it("lists proposed ADRs linked to owned systems only", async () => {
    const { db, owner, alice, slug, now } = await setup();
    const a = await createAdr(db, owner, slug, adrBody("Proposed one", ["api"]));
    const b = await createAdr(db, owner, slug, adrBody("Accepted one", ["api"]));
    await acceptAdr(db, owner, slug, b.number);
    const items = (await myWork(db, alice, { now })).filter((i) => i.kind === "decision");
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Proposed one");
    expect(items[0].href).toBe(`/p/${slug}/adrs/${a.number}`);
  });

  it("lists changes by others and by the actor's own agent, not by the actor", async () => {
    const { db, owner, alice, sys, now } = await setup();
    await db.delete(changeLog);
    const row = { projectId: sys.projectId, systemId: sys.id, entity: "system", entityId: sys.id, field: "summary" };
    const t = now.getTime();
    await db.insert(changeLog).values([
      { ...row, authorUserId: owner.userId, newValue: "x", createdAt: new Date(t - 3000) },
      { ...row, authorUserId: alice.userId, newValue: "y", createdAt: new Date(t - 2000) },
      { ...row, authorUserId: alice.userId, agent: "Claude Code", newValue: "z", createdAt: new Date(t - 1000) },
    ]);
    const changes = (await myWork(db, alice, { now })).filter((i) => i.section === "changes");
    expect(changes.map((c) => [c.agent, c.authorName])).toEqual([
      ["Claude Code", alice.name],
      [null, owner.name],
    ]);
    expect(changes[0].detail).toBe("API · DEMO");
    expect(changes[0].title).toBe("edited the summary of API");
  });

  it("lists only changes after the seen time", async () => {
    const { db, owner, alice, sys, now } = await setup();
    await db.delete(changeLog);
    const row = { projectId: sys.projectId, systemId: sys.id, entity: "system", entityId: sys.id, field: "summary", authorUserId: owner.userId };
    const seen = new Date(now.getTime() - 60_000);
    await db.insert(changeLog).values([
      { ...row, createdAt: new Date(now.getTime() - 3_600_000) },
      { ...row, createdAt: now },
    ]);
    expect((await myWork(db, alice, { now })).filter((i) => i.section === "changes")).toHaveLength(2);
    await markMyWorkSeen(db, alice, seen);
    const changes = (await myWork(db, alice, { now })).filter((i) => i.section === "changes");
    expect(changes).toHaveLength(1);
    expect(changes[0].at).toEqual(now);
  });

  it("shows nothing from a project the actor was removed from", async () => {
    const { db, owner, alice, slug, now } = await setup();
    await addQuestion(db, owner, slug, { title: "Q", system: "api" });
    expect((await myWork(db, alice, { now })).length).toBeGreaterThan(0);
    await removeMember(db, owner, slug, alice.userId);
    expect(await myWork(db, alice, { now })).toEqual([]);
  });

  it("shows nothing once the account is removed", async () => {
    const { db, owner, alice, slug, now } = await setup();
    await addQuestion(db, owner, slug, { title: "Q", system: "api" });
    const [u] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, alice.userId));
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, u.discordId!));
    expect(await myWork(db, alice, { now })).toEqual([]);
  });

  it("leaves out archived systems", async () => {
    const { db, owner, alice, slug, now } = await setup();
    await addQuestion(db, owner, slug, { title: "Q", system: "api" });
    await setSystemArchived(db, owner, slug, "api", true);
    expect(await myWork(db, alice, { now })).toEqual([]);
  });

  it("does not list a project where the actor is only an admin", async () => {
    const { db, owner, slug, now } = await setup();
    await addQuestion(db, owner, slug, { title: "Q", system: "api" });
    const admin = await insertUser(db, { isAdmin: true });
    expect(await myWork(db, admin, { now })).toEqual([]);
    // As a member who owns a system with a waiting item, then removed: nothing from that project remains.
    await setMember(db, owner, slug, { userId: admin.userId, role: "editor" });
    await updateSystem(db, owner, slug, "api", { ownerUserId: admin.userId });
    expect((await myWork(db, admin, { now })).filter((i) => i.section === "waiting").map((i) => i.title)).toEqual(["Q"]);
    await removeMember(db, owner, slug, admin.userId);
    expect(await myWork(db, admin, { now })).toEqual([]);
  });
});
