import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { eventRequest, project, user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { ForbiddenError, NotFoundError } from "./errors";
import { canAcceptRequests, eventFlags, requestAccess, requireEventDeveloper, requireEventManager } from "./request-access";

/** A database with every kind of actor and a request of R linked to a project where P is a viewer and E an editor. */
async function world() {
  const db = await createTestDb();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const R = await insertUser(db, { name: "Requester" });
  const U = await insertUser(db, { name: "Other" });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const A = await insertUser(db, { name: "Admin", isAdmin: true });
  const P = await addMemberFixture(db, owner, slug, "viewer", "Viewer member");
  const E = await addMemberFixture(db, owner, slug, "editor", "Editor member");
  const request = await requestFixture(db, R, { projectId });
  const setStatus = (status: "draft" | "submitted" | "done") => db.update(eventRequest).set({ status }).where(eq(eventRequest.id, request.id));
  return { db, R, U, M, D, A, P, E, request, projectId, setStatus };
}

describe("requestAccess view", () => {
  it("shows a draft to the requester, managers and admins only", async () => {
    const w = await world();
    for (const a of [w.R, w.M, w.A]) await expect(requestAccess(w.db, a, w.request.id, "view")).resolves.toBeDefined();
    for (const a of [w.D, w.P, w.E, w.U]) await expect(requestAccess(w.db, a, w.request.id, "view")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a submitted request to developers and linked-project members too, never to others", async () => {
    const w = await world();
    await w.setStatus("submitted");
    for (const a of [w.R, w.M, w.A, w.D, w.P, w.E]) await expect(requestAccess(w.db, a, w.request.id, "view")).resolves.toBeDefined();
    await expect(requestAccess(w.db, w.U, w.request.id, "view")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hides an unknown request", async () => {
    const w = await world();
    await expect(requestAccess(w.db, w.A, "nope", "view")).rejects.toThrow("Unknown request nope.");
  });

  it("keeps a request whose requester was deleted visible to managers", async () => {
    const w = await world();
    await w.db.delete(user).where(eq(user.id, w.R.userId));
    const access = await requestAccess(w.db, w.M, w.request.id, "view");
    expect(access.request.requesterId).toBeNull();
    await expect(requestAccess(w.db, w.U, w.request.id, "view")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is not changed by an archived linked project", async () => {
    const w = await world();
    await w.setStatus("submitted");
    await w.db.update(project).set({ archivedAt: new Date() }).where(eq(project.id, w.projectId));
    await expect(requestAccess(w.db, w.P, w.request.id, "view")).resolves.toBeDefined();
    await expect(requestAccess(w.db, w.E, w.request.id, "develop")).resolves.toBeDefined();
  });
});

describe("requestAccess edit", () => {
  it("lets the requester edit while open and managers and admins always", async () => {
    const w = await world();
    await w.setStatus("submitted");
    expect((await requestAccess(w.db, w.R, w.request.id, "edit")).canEdit).toBe(true);
    await w.setStatus("done");
    await expect(requestAccess(w.db, w.R, w.request.id, "edit")).rejects.toBeInstanceOf(ForbiddenError);
    for (const a of [w.M, w.A]) expect((await requestAccess(w.db, a, w.request.id, "edit")).canEdit).toBe(true);
  });

  it("refuses view-only actors with a ForbiddenError", async () => {
    const w = await world();
    await w.setStatus("submitted");
    await expect(requestAccess(w.db, w.D, w.request.id, "edit")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestAccess(w.db, w.P, w.request.id, "edit")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reports canEdit false on view for a non-editor", async () => {
    const w = await world();
    await w.setStatus("submitted");
    expect((await requestAccess(w.db, w.D, w.request.id, "view")).canEdit).toBe(false);
  });
});

describe("requestAccess manage", () => {
  it("allows only event managers and admins", async () => {
    const w = await world();
    await w.setStatus("submitted");
    for (const a of [w.M, w.A]) await expect(requestAccess(w.db, a, w.request.id, "manage")).resolves.toBeDefined();
    for (const a of [w.R, w.D, w.P, w.E]) await expect(requestAccess(w.db, a, w.request.id, "manage")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requestAccess develop", () => {
  it("allows developers, admins and editors of the linked project", async () => {
    const w = await world();
    await w.setStatus("submitted");
    for (const a of [w.D, w.A, w.E]) await expect(requestAccess(w.db, a, w.request.id, "develop")).resolves.toBeDefined();
  });

  it("refuses the requester and a viewer member with a ForbiddenError", async () => {
    const w = await world();
    await w.setStatus("submitted");
    for (const a of [w.R, w.P]) await expect(requestAccess(w.db, a, w.request.id, "develop")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("roles and flags", () => {
  it("reports the relation of the actor", async () => {
    const w = await world();
    await w.setStatus("submitted");
    const roles = await Promise.all([w.R, w.M, w.A, w.D, w.P].map(async (a) => (await requestAccess(w.db, a, w.request.id, "view")).role));
    expect(roles).toEqual(["requester", "manager", "staff", "developer", "project"]);
  });

  it("reads the flags and applies the guards", async () => {
    const w = await world();
    expect(await eventFlags(w.db, w.M)).toEqual({ isAdmin: false, isEventManager: true, isEventDeveloper: false });
    expect(await eventFlags(w.db, w.A)).toEqual({ isAdmin: true, isEventManager: false, isEventDeveloper: false });
    const none = await eventFlags(w.db, w.U);
    expect(() => requireEventManager(none)).toThrow(ForbiddenError);
    expect(() => requireEventDeveloper(none)).toThrow(ForbiddenError);
    expect(canAcceptRequests(none)).toBe(false);
    expect(canAcceptRequests(await eventFlags(w.db, w.D))).toBe(true);
    expect(canAcceptRequests(await eventFlags(w.db, w.A))).toBe(true);
    expect(canAcceptRequests(await eventFlags(w.db, w.M))).toBe(false);
  });
});
