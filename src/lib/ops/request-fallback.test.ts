import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventChecklistItem, eventFallback, eventRequest } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { ConflictError, ForbiddenError, InvalidError } from "./errors";
import { addFallback, fallbackReady, listFallbacks, removeFallback, saveFallback } from "./request-fallback";
import { createRequest, startEventWeek } from "./requests";

async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const request = await requestFixture(db, R, { status: "accepted", startsAt: new Date(Date.now() + 30 * 86_400_000) });
  const fallbacks = await listFallbacks(db, R, request.id);
  const byKey = (key: string) => fallbacks.find((f) => f.key === key)!;
  return { db, R, M, D, request, byKey };
}

describe("new requests", () => {
  it("have one empty required fallback and no checklist items", async () => {
    const db = await createTestDb();
    const M = await insertUser(db, { isEventManager: true });
    const created = await createRequest(db, M, { title: "Party", brief: "b" });
    const fallbacks = await db.select().from(eventFallback).where(eq(eventFallback.requestId, created.id));
    expect(fallbacks.map((f) => f.key).sort()).toEqual(["server-down"]);
    expect(fallbacks.every((f) => f.required && f.whatWeDo === "" && f.whoDecides === "")).toBe(true);
    expect(await db.select().from(eventChecklistItem).where(eq(eventChecklistItem.requestId, created.id))).toHaveLength(0);
  });

  it("are the same for request fixtures", async () => {
    const w = await world();
    expect(await listFallbacks(w.db, w.R, w.request.id)).toHaveLength(1);
    expect(await w.db.select().from(eventChecklistItem).where(eq(eventChecklistItem.requestId, w.request.id))).toHaveLength(0);
  });
});

describe("fallbackReady", () => {
  it("lists the one scenario as missing both fields at first", async () => {
    const w = await world();
    const ready = await fallbackReady(w.db, w.request.id);
    expect(ready.ready).toBe(false);
    expect(ready.missing.map((m) => [m.key, m.missing])).toEqual([
      ["server-down", ["whatWeDo", "whoDecides"]],
    ]);
  });

  it("treats whitespace as missing and ignores blank custom scenarios", async () => {
    const w = await world();
    await saveFallback(w.db, w.R, w.request.id, w.byKey("server-down").id, { whatWeDo: "   ", whoDecides: "Host" });
    await addFallback(w.db, w.R, w.request.id, { title: "Rain" });
    const ready = await fallbackReady(w.db, w.request.id);
    expect(ready.missing).toEqual([{ key: "server-down", title: "Server dies mid-event", missing: ["whatWeDo"] }]);
    await saveFallback(w.db, w.R, w.request.id, w.byKey("server-down").id, { whatWeDo: "Restart" });
    expect((await fallbackReady(w.db, w.request.id)).ready).toBe(true);
  });
});

describe("saveFallback and friends", () => {
  it("refuses renaming a required scenario but renames a custom one", async () => {
    const w = await world();
    await expect(saveFallback(w.db, w.R, w.request.id, w.byKey("server-down").id, { title: "Other" })).rejects.toBeInstanceOf(InvalidError);
    const custom = await addFallback(w.db, w.R, w.request.id, { title: "Rain" });
    expect(custom.key).toMatch(/^custom-/);
    expect((await saveFallback(w.db, w.R, w.request.id, custom.id, { title: "Storm" })).title).toBe("Storm");
  });

  it("removes custom scenarios only", async () => {
    const w = await world();
    await expect(removeFallback(w.db, w.R, w.request.id, w.byKey("server-down").id)).rejects.toBeInstanceOf(ConflictError);
    const custom = await addFallback(w.db, w.R, w.request.id, { title: "Rain" });
    await removeFallback(w.db, w.R, w.request.id, custom.id);
    expect(await listFallbacks(w.db, w.R, w.request.id)).toHaveLength(1);
  });

  it("needs edit access", async () => {
    const w = await world();
    await expect(saveFallback(w.db, w.D, w.request.id, w.byKey("server-down").id, { whatWeDo: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("startEventWeek", () => {
  const fillAll = async (w: Awaited<ReturnType<typeof world>>) => {
    for (const f of await listFallbacks(w.db, w.R, w.request.id)) await saveFallback(w.db, w.R, w.request.id, f.id, { whatWeDo: "Do", whoDecides: "Host" });
  };

  it("names the missing scenarios and fields", async () => {
    const w = await world();
    const error = await startEventWeek(w.db, w.R, w.request.id).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain("Server dies mid-event");
    expect(error.message).toContain("whoDecides");
  });

  it("moves an accepted request to event_week", async () => {
    const w = await world();
    await fillAll(w);
    expect((await startEventWeek(w.db, w.M, w.request.id)).status).toBe("event_week");
  });

  it("refuses a submitted request", async () => {
    const w = await world();
    await fillAll(w);
    await w.db.update(eventRequest).set({ status: "submitted" }).where(eq(eventRequest.id, w.request.id));
    await expect(startEventWeek(w.db, w.M, w.request.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets a develop actor pass and refuses a viewer", async () => {
    const w = await world();
    await fillAll(w);
    const p = await createProjectFixture(w.db, "evt");
    const viewer = await addMemberFixture(w.db, p.owner, p.slug, "viewer");
    await w.db.update(eventRequest).set({ projectId: p.projectId }).where(eq(eventRequest.id, w.request.id));
    await expect(startEventWeek(w.db, viewer, w.request.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await startEventWeek(w.db, w.D, w.request.id)).status).toBe("event_week");
  });
});
