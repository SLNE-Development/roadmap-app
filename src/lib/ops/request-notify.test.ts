import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventRequest, notification, type NotificationKind } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { developerIds, managerIds, notifyRequest } from "./request-notify";
import { recallRequest, saveBrief, submitRequest } from "./requests";

const FUTURE = new Date(Date.now() + 30 * 86_400_000);

/** A database with a requester, a manager, a developer, an admin, and a project with an owner, an editor and a viewer. */
async function world() {
  const db = await createTestDb();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const R = await insertUser(db, { name: "Requester" });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const A = await insertUser(db, { name: "Admin", isAdmin: true });
  const E = await addMemberFixture(db, owner, slug, "editor", "Editor");
  await addMemberFixture(db, owner, slug, "viewer", "Viewer");
  const request = await requestFixture(db, R, { startsAt: FUTURE });
  const recipients = async (kind: NotificationKind) => (await db.select().from(notification).where(eq(notification.kind, kind))).map((r) => r.userId).sort();
  return { db, owner, projectId, R, M, D, A, E, request, recipients };
}

describe("recipient helpers", () => {
  it("finds developers and managers, admins included", async () => {
    const w = await world();
    expect((await developerIds(w.db)).sort()).toEqual([w.D.userId, w.A.userId].sort());
    expect((await managerIds(w.db)).sort()).toEqual([w.M.userId, w.A.userId].sort());
  });
});

describe("notifyRequest", () => {
  it("skips the actor, links to the request and counts the rows created", async () => {
    const w = await world();
    const n = await notifyRequest(w.db, {
      requestId: w.request.id,
      kind: "request.question",
      userIds: [w.R.userId, w.M.userId],
      title: "Question",
      sourceKey: "req:q",
      tab: "overview",
      actor: w.M,
    });
    expect(n).toBe(1);
    const [row] = await w.db.select().from(notification);
    expect(row).toMatchObject({ userId: w.R.userId, href: `/requests/${w.request.id}?tab=overview`, entity: "request", actorName: "Manager" });
  });

  it("reaches everyone without an actor", async () => {
    const w = await world();
    const n = await notifyRequest(w.db, { requestId: w.request.id, kind: "request.todo_due", userIds: [w.R.userId, w.M.userId], title: "Due", sourceKey: "req:t", actor: null });
    expect(n).toBe(2);
  });
});

describe("request senders", () => {
  it("notifies developers and admins when submitted", async () => {
    const w = await world();
    await submitRequest(w.db, w.R, w.request.id);
    expect(await w.recipients("request.submitted")).toEqual([w.D.userId, w.A.userId].sort());
  });

  it("never notifies the submitting developer", async () => {
    const w = await world();
    await w.db.update(eventRequest).set({ requesterId: w.D.userId }).where(eq(eventRequest.id, w.request.id));
    await submitRequest(w.db, w.D, w.request.id);
    expect(await w.recipients("request.submitted")).toEqual([w.A.userId]);
  });

  it("notifies again when resubmitted after a recall", async () => {
    const w = await world();
    await submitRequest(w.db, w.R, w.request.id);
    await recallRequest(w.db, w.R, w.request.id);
    await submitRequest(w.db, w.R, w.request.id);
    expect(await w.recipients("request.submitted")).toHaveLength(4);
  });

  it("notifies the project editors, not viewers or the requester, when an accepted brief changes", async () => {
    const w = await world();
    await w.db.update(eventRequest).set({ status: "accepted", projectId: w.projectId }).where(eq(eventRequest.id, w.request.id));
    await saveBrief(w.db, w.R, w.request.id, { body: "New brief", baseVersion: 1 });
    expect(await w.recipients("request.brief_changed")).toEqual([w.owner.userId, w.E.userId].sort());
  });

  it("notifies nobody when a draft brief changes", async () => {
    const w = await world();
    await saveBrief(w.db, w.R, w.request.id, { body: "New brief", baseVersion: 1 });
    expect(await w.recipients("request.brief_changed")).toEqual([]);
  });
});
