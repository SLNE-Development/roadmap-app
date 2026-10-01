import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventBriefVersion, eventRequest, requestLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import {
  cancelRequest,
  compareBriefs,
  createRequest,
  getBrief,
  getRequest,
  listBriefVersions,
  listRequests,
  markDone,
  recallRequest,
  requestRights,
  requestHistory,
  saveBrief,
  submitRequest,
  updateRequest,
  withdrawRequest,
} from "./requests";

const FUTURE = new Date(Date.now() + 30 * 86_400_000);

/** A database with a requester, a manager, a developer, an admin and a stranger. */
async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const A = await insertUser(db, { name: "Admin", isAdmin: true });
  const U = await insertUser(db, { name: "Stranger" });
  const setStatus = (id: string, status: "draft" | "submitted" | "accepted" | "event_week" | "done") =>
    db.update(eventRequest).set({ status }).where(eq(eventRequest.id, id));
  const logFields = async (id: string) => (await db.select().from(requestLog).where(eq(requestLog.requestId, id)).orderBy(requestLog.id)).map((r) => r.field);
  return { db, R, M, D, A, U, setStatus, logFields };
}

describe("createRequest", () => {
  it("refuses a non-manager", async () => {
    const w = await world();
    await expect(createRequest(w.db, w.R, { title: "Party", brief: "" })).rejects.toThrow(new ForbiddenError("Only event managers can create requests."));
  });

  it("writes brief version 1 even when empty and logs the creation", async () => {
    const w = await world();
    const row = await createRequest(w.db, w.M, { title: "Party", brief: "" });
    expect(row).toMatchObject({ status: "draft", briefVersion: 1, requesterId: w.M.userId });
    const versions = await w.db.select().from(eventBriefVersion).where(eq(eventBriefVersion.requestId, row.id));
    expect(versions).toHaveLength(1);
    expect(await w.logFields(row.id)).toEqual(["created"]);
  });

  it("creates on behalf of another user and rejects an unknown one", async () => {
    const w = await world();
    const row = await createRequest(w.db, w.A, { title: "Party", brief: "Hi", requesterId: w.R.userId, startsAt: FUTURE.toISOString(), durationMinutes: 60 });
    expect(row.requesterId).toBe(w.R.userId);
    expect(row.startsAt?.getTime()).toBe(FUTURE.getTime());
    await expect(createRequest(w.db, w.M, { title: "Party", brief: "", requesterId: "ghost" })).rejects.toBeInstanceOf(InvalidError);
  });

  it("validates the input", async () => {
    const w = await world();
    await expect(createRequest(w.db, w.M, { title: "", brief: "" })).rejects.toThrow();
    await expect(createRequest(w.db, w.M, { title: "x", brief: "", eventDocsUrl: "http://example.com" })).rejects.toThrow();
    await expect(createRequest(w.db, w.M, { title: "x", brief: "", durationMinutes: 1 })).rejects.toThrow();
  });
});

describe("saveBrief", () => {
  it("makes version 2 for a changed body and logs without the body", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    expect(await saveBrief(w.db, w.R, req.id, { body: "New text", baseVersion: 1 })).toEqual({ version: 2, changed: true });
    expect((await getBrief(w.db, w.R, req.id)).body).toBe("New text");
    const [log] = await w.db.select().from(requestLog).where(eq(requestLog.field, "brief"));
    expect(log).toMatchObject({ oldValue: "v1", newValue: "v2" });
  });

  it("saves nothing for an identical body apart from whitespace at the ends and line endings", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await saveBrief(w.db, w.R, req.id, { body: "a\nb", baseVersion: 1 });
    expect(await saveBrief(w.db, w.R, req.id, { body: "a\r\nb\r\n", baseVersion: 2 })).toEqual({ version: 2, changed: false });
    expect(await w.db.select().from(eventBriefVersion).where(eq(eventBriefVersion.requestId, req.id))).toHaveLength(2);
  });

  it("refuses a stale base version", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await saveBrief(w.db, w.R, req.id, { body: "one", baseVersion: 1 });
    await expect(saveBrief(w.db, w.R, req.id, { body: "two", baseVersion: 1 })).rejects.toThrow(
      new ConflictError("The brief changed in the meantime. Reload and merge your edits."),
    );
  });

  it("lets exactly one of two concurrent saves win", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    const results = await Promise.allSettled([
      saveBrief(w.db, w.R, req.id, { body: "first", baseVersion: 1 }),
      saveBrief(w.db, w.M, req.id, { body: "second", baseVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected");
    expect((lost as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await w.db.select().from(eventBriefVersion).where(eq(eventBriefVersion.requestId, req.id))).toHaveLength(2);
  });

  it("is refused in a closed request and for a view-only actor", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { status: "submitted" });
    await expect(saveBrief(w.db, w.D, req.id, { body: "x", baseVersion: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveBrief(w.db, w.U, req.id, { body: "x", baseVersion: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await w.setStatus(req.id, "done");
    await expect(saveBrief(w.db, w.R, req.id, { body: "x", baseVersion: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveBrief(w.db, w.M, req.id, { body: "x", baseVersion: 1 })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("compareBriefs and versions", () => {
  it("counts a one-line change and lists versions newest first", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await saveBrief(w.db, w.R, req.id, { body: "line one\nline two", baseVersion: 1 });
    await saveBrief(w.db, w.R, req.id, { body: "line one\nline 2", baseVersion: 2 });
    const diff = await compareBriefs(w.db, w.R, req.id, 2, 3);
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect((await listBriefVersions(w.db, w.R, req.id)).map((v) => v.version)).toEqual([3, 2, 1]);
    expect((await listBriefVersions(w.db, w.R, req.id))[0].authorName).toBe("Requester");
    expect((await getBrief(w.db, w.R, req.id, 2)).body).toBe("line one\nline two");
    await expect(getBrief(w.db, w.R, req.id, 9)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs from lower than to", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await expect(compareBriefs(w.db, w.R, req.id, 1, 1)).rejects.toBeInstanceOf(InvalidError);
    await expect(compareBriefs(w.db, w.R, req.id, 2, 1)).rejects.toBeInstanceOf(InvalidError);
  });
});

describe("submitRequest", () => {
  it("lists what is missing", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await expect(submitRequest(w.db, w.R, req.id)).rejects.toThrow(/event date/);
    await w.db.update(eventRequest).set({ startsAt: new Date(Date.now() - 1000) }).where(eq(eventRequest.id, req.id));
    await expect(submitRequest(w.db, w.R, req.id)).rejects.toThrow(/event date in the future/);
    await w.db.update(eventRequest).set({ startsAt: FUTURE }).where(eq(eventRequest.id, req.id));
    await w.db.update(eventBriefVersion).set({ body: "  " }).where(eq(eventBriefVersion.requestId, req.id));
    await expect(submitRequest(w.db, w.R, req.id)).rejects.toThrow(/brief/);
  });

  it("submits a complete request once", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { startsAt: FUTURE });
    const row = await submitRequest(w.db, w.R, req.id);
    expect(row.status).toBe("submitted");
    expect(row.submittedAt).toBeInstanceOf(Date);
    expect(await w.logFields(req.id)).toEqual(["status"]);
    await expect(submitRequest(w.db, w.R, req.id)).rejects.toThrow(new ConflictError("A submitted request cannot become submitted."));
  });
});

describe("transitions", () => {
  it("recalls a submitted request and withdraws a draft or submitted one", async () => {
    const w = await world();
    const a = await requestFixture(w.db, w.R, { status: "submitted" });
    expect((await recallRequest(w.db, w.R, a.id)).status).toBe("draft");
    await expect(recallRequest(w.db, w.R, a.id)).rejects.toThrow("A draft request cannot become draft.");
    expect((await withdrawRequest(w.db, w.R, a.id)).status).toBe("withdrawn");
    const b = await requestFixture(w.db, w.R, { status: "submitted" });
    expect((await withdrawRequest(w.db, w.R, b.id)).status).toBe("withdrawn");
    await expect(withdrawRequest(w.db, w.R, b.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(withdrawRequest(w.db, w.R, (await requestFixture(w.db, w.R, { status: "accepted" })).id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("cancels an accepted request with a reason for managers and developers only", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { status: "accepted" });
    await expect(cancelRequest(w.db, w.R, req.id, "no time")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelRequest(w.db, w.M, req.id, "  ")).rejects.toThrow();
    expect((await cancelRequest(w.db, w.D, req.id, "no time")).status).toBe("cancelled");
    const [log] = await w.db.select().from(requestLog).where(eq(requestLog.requestId, req.id));
    expect(log).toMatchObject({ field: "status", oldValue: "accepted", newValue: "no time" });
    const other = await requestFixture(w.db, w.R, { status: "event_week" });
    expect((await cancelRequest(w.db, w.M, other.id, "storm")).status).toBe("cancelled");
    const draft = await requestFixture(w.db, w.R);
    await expect(cancelRequest(w.db, w.M, draft.id, "x")).rejects.toBeInstanceOf(ConflictError);
  });

  it("marks done only from event week", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { status: "accepted" });
    await expect(markDone(w.db, w.M, req.id)).rejects.toThrow("A accepted request cannot become done.");
    await w.setStatus(req.id, "event_week");
    expect((await markDone(w.db, w.M, req.id)).status).toBe("done");
  });
});

describe("updateRequest", () => {
  it("writes one log row per changed field and none for unchanged ones", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { title: "Old", where: "Spawn" });
    await updateRequest(w.db, w.R, req.id, { title: "New", where: "Spawn", durationMinutes: 90, startsAt: FUTURE });
    expect(await w.logFields(req.id)).toEqual(["title", "startsAt", "durationMinutes"]);
    await updateRequest(w.db, w.R, req.id, { title: "New", durationMinutes: 90 });
    expect(await w.logFields(req.id)).toHaveLength(3);
  });

  it("lets only managers change the requester", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await expect(updateRequest(w.db, w.R, req.id, { requesterId: w.U.userId })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await updateRequest(w.db, w.M, req.id, { requesterId: w.U.userId })).requesterId).toBe(w.U.userId);
  });

  it("rejects a past date once submitted but not in a draft", async () => {
    const w = await world();
    const past = new Date(Date.now() - 86_400_000);
    const draft = await requestFixture(w.db, w.R);
    await expect(updateRequest(w.db, w.R, draft.id, { startsAt: past })).resolves.toBeDefined();
    const sent = await requestFixture(w.db, w.R, { status: "submitted", startsAt: FUTURE });
    await expect(updateRequest(w.db, w.R, sent.id, { startsAt: past })).rejects.toBeInstanceOf(InvalidError);
  });

  it("lets only managers edit a closed request", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { status: "done" });
    await expect(updateRequest(w.db, w.R, req.id, { title: "x" })).rejects.toBeInstanceOf(ConflictError);
    expect((await updateRequest(w.db, w.A, req.id, { title: "x" })).title).toBe("x");
  });
});

describe("views", () => {
  it("hides a request from a stranger", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await expect(getRequest(w.db, w.U, req.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestHistory(w.db, w.U, req.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns the detail with brief, role and edit rights", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R, { status: "submitted" });
    const asRequester = await getRequest(w.db, w.R, req.id);
    expect(asRequester).toMatchObject({ requesterName: "Requester", brief: "Brief", role: "requester", canEdit: true, canManage: false });
    expect(await getRequest(w.db, w.D, req.id)).toMatchObject({ role: "developer", canEdit: false });
    expect(await getRequest(w.db, w.A, req.id)).toMatchObject({ role: "manager", canManage: true });
  });

  it("lists by visibility, open first and sorted by date", async () => {
    const w = await world();
    const mine = await requestFixture(w.db, w.R, { title: "Mine draft" });
    const sent = await requestFixture(w.db, w.R, { title: "Sent", status: "submitted", startsAt: FUTURE });
    const done = await requestFixture(w.db, w.R, { title: "Done", status: "done", startsAt: new Date(Date.now() - 1000) });
    const other = await requestFixture(w.db, w.U, { title: "Other draft" });
    const titles = async (a: typeof w.R, filter = {}) => (await listRequests(w.db, a, filter)).map((r) => r.title);
    expect(await titles(w.R)).toEqual(["Sent", "Mine draft", "Done"]);
    expect(await titles(w.D)).toEqual(["Sent", "Done"]);
    expect((await titles(w.M)).sort()).toEqual(["Done", "Mine draft", "Other draft", "Sent"]);
    expect(await titles(w.M, { scope: "open" })).toEqual(["Sent", "Mine draft", "Other draft"]);
    expect(await titles(w.M, { mine: true })).toEqual([]);
    expect(await titles(w.M, { status: ["done"] })).toEqual(["Done"]);
    expect(await titles(w.U)).toEqual(["Other draft"]);
    const [first] = await listRequests(w.db, w.R, {});
    expect(first).toMatchObject({ id: sent.id, requesterName: "Requester", projectSlug: null, briefVersion: 1, waitingOnRequester: false });
    expect([mine.id, done.id, other.id]).toHaveLength(3);
  });

  it("returns the history newest first", async () => {
    const w = await world();
    const req = await requestFixture(w.db, w.R);
    await updateRequest(w.db, w.R, req.id, { title: "A" });
    await updateRequest(w.db, w.R, req.id, { title: "B" });
    const rows = await requestHistory(w.db, w.R, req.id);
    expect(rows.map((r) => r.newValue)).toEqual(["B", "A"]);
    expect(rows[0]).toMatchObject({ field: "title", authorName: "Requester" });
    expect(await requestHistory(w.db, w.R, req.id, 1)).toHaveLength(1);
  });
});

describe("requestRights", () => {
  it("shows the Requests section to staff and owners only", async () => {
    const w = await world();
    await requestFixture(w.db, w.R);
    expect(await requestRights(w.db, w.R)).toEqual({ isEventManager: false, isEventDeveloper: false, showRequests: true });
    expect(await requestRights(w.db, w.M)).toMatchObject({ isEventManager: true, showRequests: true });
    expect(await requestRights(w.db, w.D)).toMatchObject({ isEventDeveloper: true, showRequests: true });
    expect((await requestRights(w.db, w.A)).showRequests).toBe(true);
    expect((await requestRights(w.db, w.U)).showRequests).toBe(false);
  });
});
