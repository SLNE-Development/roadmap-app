import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventChecklistItem, eventRequest, eventTodo } from "@/db/schema";
import { DEFAULT_EVENT_TIME_ZONE, dueFor, PREP_TEMPLATE } from "@/lib/event-prep-template";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { acceptRequest } from "./request-link";
import {
  addChecklistItem,
  addTodo,
  eventDayView,
  listChecklist,
  listTodos,
  removeChecklistItem,
  removeTodo,
  setChecklistItem,
  setTodoDone,
  updateTodo,
} from "./request-prep";
import { updateRequest } from "./requests";
import { createProjectFixture, addMemberFixture } from "@/test/fixtures";

/** A world with a submitted request, a requester, a developer, a manager and a stranger. */
async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const S = await insertUser(db, { name: "Stranger" });
  const request = await requestFixture(db, R, { status: "submitted", startsAt: new Date(Date.now() + 30 * 86_400_000), durationMinutes: 60 });
  return { db, R, D, M, S, request };
}

/** A world with an accepted request whose six to-dos exist and two keyed checklist items (the kind an older request keeps). */
async function accepted() {
  const w = await world();
  await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
  await w.db.insert(eventChecklistItem).values([
    { id: "item-a", requestId: w.request.id, key: "kept-a", label: "Server checked", sortOrder: 0 },
    { id: "item-b", requestId: w.request.id, key: "kept-b", label: "Staff online", sortOrder: 1 },
  ]);
  return w;
}

describe("prep to-dos on accept", () => {
  it("creates six to-dos at the template dates", async () => {
    const w = await accepted();
    const todos = await listTodos(w.db, w.R, w.request.id);
    expect(todos).toHaveLength(6);
    const start = w.request.startsAt!;
    for (const step of PREP_TEMPLATE) {
      const todo = todos.find((t) => t.templateKey === step.key)!;
      expect(todo.dueAt.getTime()).toBe(dueFor(start, step.offsetDays, DEFAULT_EVENT_TIME_ZONE).getTime());
      expect(todo.ownerUserId).toBe(step.owner === "requester" ? w.R.userId : w.D.userId);
    }
  });

  it("moves untouched to-dos with the event date, not done or hand-dated ones", async () => {
    const w = await accepted();
    const [done, manual, free] = await listTodos(w.db, w.R, w.request.id);
    await setTodoDone(w.db, w.R, done.id, true);
    const hand = new Date("2030-01-01T09:00:00Z");
    await updateTodo(w.db, w.R, manual.id, { dueAt: hand });
    const later = new Date(w.request.startsAt!.getTime() + 2 * 86_400_000);
    await updateRequest(w.db, w.M, w.request.id, { startsAt: later });
    const after = await w.db.select().from(eventTodo).where(eq(eventTodo.requestId, w.request.id));
    const get = (id: string) => after.find((t) => t.id === id)!;
    expect(get(done.id).dueAt.getTime()).toBe(done.dueAt.getTime());
    expect(get(manual.id).dueAt.getTime()).toBe(hand.getTime());
    const step = PREP_TEMPLATE.find((s) => s.key === free.templateKey)!;
    expect(get(free.id).dueAt.getTime()).toBe(dueFor(later, step.offsetDays, DEFAULT_EVENT_TIME_ZONE).getTime());
  });
});

describe("todo ops", () => {
  it("sets dueManual on a new due date and refuses an unprovisioned owner", async () => {
    const w = await accepted();
    const [todo] = await listTodos(w.db, w.R, w.request.id);
    const updated = await updateTodo(w.db, w.R, todo.id, { dueAt: new Date("2030-01-01T09:00:00Z") });
    expect(updated.dueManual).toBe(true);
    await expect(updateTodo(w.db, w.R, todo.id, { ownerUserId: "nobody" })).rejects.toBeInstanceOf(InvalidError);
    expect((await updateTodo(w.db, w.R, todo.id, { ownerUserId: w.D.userId })).ownerUserId).toBe(w.D.userId);
  });

  it("derives late from the due date and done state", async () => {
    const w = await accepted();
    const t = await addTodo(w.db, w.R, w.request.id, { title: "Buy cake", dueAt: new Date(Date.now() - 3600_000) });
    const find = async () => (await listTodos(w.db, w.R, w.request.id)).find((x) => x.id === t.id)!;
    expect((await find()).late).toBe(true);
    await setTodoDone(w.db, w.R, t.id, true);
    expect((await find()).late).toBe(false);
    await setTodoDone(w.db, w.R, t.id, false);
    expect((await find()).late).toBe(true);
  });

  it("removes custom to-dos only", async () => {
    const w = await accepted();
    const [template] = await listTodos(w.db, w.R, w.request.id);
    await expect(removeTodo(w.db, w.R, template.id)).rejects.toBeInstanceOf(ConflictError);
    const custom = await addTodo(w.db, w.R, w.request.id, { title: "x", dueAt: new Date() });
    await removeTodo(w.db, w.R, custom.id);
  });

  it("hides to-dos from strangers", async () => {
    const w = await accepted();
    await expect(listTodos(w.db, w.S, w.request.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("a request without a date", () => {
  it("cannot lose its date once submitted", async () => {
    const w = await accepted();
    await expect(updateRequest(w.db, w.M, w.request.id, { startsAt: null })).rejects.toBeInstanceOf(InvalidError);
  });

  it("gets its to-dos when a date arrives and none exist yet", async () => {
    const w = await accepted();
    await w.db.delete(eventTodo).where(eq(eventTodo.requestId, w.request.id));
    await updateRequest(w.db, w.M, w.request.id, { startsAt: new Date(Date.now() + 40 * 86_400_000) });
    expect(await listTodos(w.db, w.R, w.request.id)).toHaveLength(6);
  });
});

describe("develop access through the project", () => {
  it("lets a project editor tick, and canTick says so", async () => {
    const w = await accepted();
    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    const p = await createProjectFixture(w.db, "evt2");
    const editor = await addMemberFixture(w.db, p.owner, p.slug, "editor");
    await w.db.update(eventRequest).set({ status: "event_week", projectId: p.projectId }).where(eq(eventRequest.id, req.id));
    expect((await eventDayView(w.db, editor, req.id)).canTick).toBe(true);
    const [item] = await listChecklist(w.db, editor, req.id);
    expect((await setChecklistItem(w.db, editor, item.id, true)).doneBy).toBe(editor.userId);
  });
});

describe("checklist", () => {
  it("cannot be ticked before the event week", async () => {
    const w = await accepted();
    const [item] = await listChecklist(w.db, w.R, w.request.id);
    await expect(setChecklistItem(w.db, w.R, item.id, true)).rejects.toBeInstanceOf(ConflictError);
  });

  it("is ticked by the developer and the requester in event_week, not by a stranger", async () => {
    const w = await accepted();
    await w.db.update(eventRequest).set({ status: "event_week" }).where(eq(eventRequest.id, w.request.id));
    const [a, b] = await listChecklist(w.db, w.R, w.request.id);
    expect((await setChecklistItem(w.db, w.D, a.id, true)).doneAt).not.toBeNull();
    expect((await setChecklistItem(w.db, w.R, b.id, true)).doneBy).toBe(w.R.userId);
    await expect(setChecklistItem(w.db, w.S, a.id, false)).rejects.toBeInstanceOf(NotFoundError);
    expect((await setChecklistItem(w.db, w.R, a.id, false)).doneAt).toBeNull();
  });

  it("adds and removes custom items only", async () => {
    const w = await accepted();
    const [template] = await listChecklist(w.db, w.R, w.request.id);
    await expect(removeChecklistItem(w.db, w.R, template.id)).rejects.toBeInstanceOf(ConflictError);
    const custom = await addChecklistItem(w.db, w.R, w.request.id, { label: "Cake" });
    await removeChecklistItem(w.db, w.R, custom.id);
    expect(await listChecklist(w.db, w.R, w.request.id)).toHaveLength(2);
  });
});

describe("the event-day view", () => {
  it("shows a stranger only the allowed fields", async () => {
    const w = await accepted();
    await w.db.update(eventRequest).set({ status: "event_week", where: "Lobby" }).where(eq(eventRequest.id, w.request.id));
    const view = await eventDayView(w.db, w.S, w.request.id);
    expect(Object.keys(view).sort()).toEqual(["canTick", "checklist", "fallbacks", "request"]);
    expect(Object.keys(view.request).sort()).toEqual(["durationMinutes", "id", "startsAt", "status", "title", "where"]);
    expect(view.canTick).toBe(false);
    expect(view.request.where).toBe("Lobby");
    expect((await eventDayView(w.db, w.R, w.request.id)).canTick).toBe(true);
  });
});
