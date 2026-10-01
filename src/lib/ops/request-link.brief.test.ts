import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventRequest } from "@/db/schema";
import { TOOLS } from "@/lib/tools/definitions";
import { runTool } from "@/lib/tools/registry";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { NotFoundError } from "./errors";
import { acceptRequest, briefStatus } from "./request-link";
import { saveBrief } from "./requests";
import { createSystem } from "./systems";

/** An accepted request (project "winter-party", system "event") with a developer, a manager and a viewer member. */
async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const request = await requestFixture(db, R, { status: "submitted", title: "Winter Party!", briefVersion: 1 });
  await acceptRequest(db, D, request.id, { mode: "create" });
  const viewer = await addMemberFixture(db, D, "winter-party", "viewer");
  const bySlug = { projectSlug: "winter-party" };
  const brief = async (n: number) => {
    const [row] = await db.select({ v: eventRequest.briefVersion }).from(eventRequest).where(eq(eventRequest.id, request.id));
    return saveBrief(db, M, request.id, { body: `Brief ${n}`, baseVersion: row.v });
  };
  return { db, R, D, M, viewer, request, bySlug, brief };
}

describe("briefStatus", () => {
  it("is current right after accepting", async () => {
    const w = await world();
    expect(await briefStatus(w.db, w.D, w.bySlug)).toEqual({
      requestId: w.request.id,
      requestTitle: "Winter Party!",
      systemSlug: "event",
      briefVersion: 1,
      specVersion: 1,
      basisBriefVersion: 1,
      state: "current",
      changeCount: 0,
    });
  });

  it("turns changed after a brief save and current again after write_spec with the new brief", async () => {
    const w = await world();
    await w.brief(2);
    expect(await briefStatus(w.db, w.D, { requestId: w.request.id })).toMatchObject({ state: "changed", changeCount: 1, specVersion: 1, basisBriefVersion: 1, briefVersion: 2 });
    await runTool(w.db, w.D, TOOLS.find((t) => t.name === "write_spec")!, { project: "winter-party", system: "event", body: "New spec", brief: 2 });
    expect(await briefStatus(w.db, w.D, w.bySlug)).toMatchObject({ state: "current", changeCount: 0, specVersion: 2, basisBriefVersion: 2 });
  });

  it("counts every brief version since the basis", async () => {
    const w = await world();
    await w.brief(2);
    await w.brief(3);
    await w.brief(4);
    expect(await briefStatus(w.db, w.D, w.bySlug)).toMatchObject({ state: "changed", changeCount: 3, briefVersion: 4 });
  });

  it("is not_applied for a request linked to an existing system", async () => {
    const db = await createTestDb();
    const R = await insertUser(db, { name: "Requester" });
    const D = await insertUser(db, { name: "Developer", isEventDeveloper: true, isAdmin: true });
    const request = await requestFixture(db, R, { status: "submitted" });
    const p = await createProjectFixture(db, "plain");
    await createSystem(db, p.owner, "plain", { slug: "s", title: "S" });
    await acceptRequest(db, D, request.id, { mode: "link", project: "plain", system: "s" });
    expect(await briefStatus(db, D, { projectSlug: "plain" })).toMatchObject({ state: "not_applied", specVersion: null, basisBriefVersion: null, changeCount: 0 });
  });

  it("hides the title from a project member who cannot view the request", async () => {
    const w = await world();
    await w.db.update(eventRequest).set({ status: "draft" }).where(eq(eventRequest.id, w.request.id));
    expect(await briefStatus(w.db, w.viewer, w.bySlug)).toMatchObject({ requestId: w.request.id, requestTitle: null, state: "current" });
    await expect(briefStatus(w.db, w.viewer, { requestId: w.request.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a project member with request access the title, and returns null without a request", async () => {
    const w = await world();
    expect((await briefStatus(w.db, w.viewer, w.bySlug))?.requestTitle).toBe("Winter Party!");
    const p = await createProjectFixture(w.db, "plain");
    expect(await briefStatus(w.db, p.owner, { projectSlug: "plain" })).toBeNull();
  });
});
