import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { board, boardColumn, domain, eventRequest, eventSpecBasis, notification, phase, project, projectMember, requestLog, system, systemDocument, task } from "@/db/schema";
import { EVENT_TEMPLATE, projectSlugFromTitle } from "@/lib/event-template";
import { TOOLS } from "@/lib/tools/definitions";
import { runTool } from "@/lib/tools/registry";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { setSystemArchived } from "./archive";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import * as notifyModule from "./request-notify";
import { acceptRequest, linkableProjects, requestProgress } from "./request-link";
import { updateRequest } from "./requests";
import { createSystem } from "./systems";

vi.mock("./request-notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./request-notify")>();
  return { ...actual, notifyRequest: vi.fn(actual.notifyRequest) };
});

const START = new Date(Date.now() + 30 * 86_400_000);

/** A database with a requester, a developer, a manager and a submitted request of 90 minutes. */
async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const M = await insertUser(db, { name: "Manager", isEventManager: true });
  const request = await requestFixture(db, R, { status: "submitted", title: "Winter Party!", startsAt: START, durationMinutes: 90, briefVersion: 1 });
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
  return { db, R, D, M, request, tool };
}

describe("projectSlugFromTitle", () => {
  it("slugifies and appends a counter on collision", async () => {
    const taken = new Set(["winter-party", "winter-party-2"]);
    expect(await projectSlugFromTitle("Winter Party!", async (s) => taken.has(s))).toBe("winter-party-3");
    expect(await projectSlugFromTitle("???", async () => false)).toBe("event");
  });
});

describe("acceptRequest create", () => {
  it("builds the event project, system, spec draft and basis in one go", async () => {
    const w = await world();
    const result = await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    expect(result).toEqual({ projectSlug: "winter-party", systemSlug: "event", specVersion: 1 });

    const [proj] = await w.db.select().from(project);
    expect(proj.name).toBe("Winter Party!");
    expect(proj.deadline?.getTime()).toBe(START.getTime() + 90 * 60_000);
    const boards = await w.db.select().from(board).where(eq(board.projectId, proj.id));
    expect(boards.map((b) => b.slug)).toEqual(["event"]);
    const columns = await w.db.select().from(boardColumn).where(eq(boardColumn.boardId, boards[0].id)).orderBy(boardColumn.sortOrder);
    expect(columns.map((c) => [c.name, c.category])).toEqual(EVENT_TEMPLATE.board.columns.map((c) => [c.name, c.category]));
    const phases = await w.db.select().from(phase).where(eq(phase.projectId, proj.id)).orderBy(phase.sortOrder);
    expect(phases.map((p) => p.name)).toEqual(["Build", "Rehearsal", "Event day"]);
    const domains = await w.db.select().from(domain).where(eq(domain.projectId, proj.id));
    expect(domains.map((d) => d.name)).toEqual(["Event"]);

    const systems = await w.db.select().from(system).where(eq(system.projectId, proj.id));
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ slug: "event", title: "Winter Party!", priority: "MVP", columnId: columns[0].id });
    const specs = await w.db.select().from(systemDocument).where(eq(systemDocument.systemId, systems[0].id));
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ kind: "spec", version: 1, body: "Brief" });
    expect(systems[0].planningCompletedAt).toBeNull();
    expect(await w.db.select().from(eventSpecBasis)).toMatchObject([{ systemId: systems[0].id, specVersion: 1, briefVersion: 1 }]);

    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    expect(req).toMatchObject({ status: "accepted", projectId: proj.id, systemId: systems[0].id, acceptedBy: w.D.userId });
    expect(req.acceptedAt).not.toBeNull();

    const members = await w.db.select().from(projectMember).where(eq(projectMember.projectId, proj.id));
    expect(members).toMatchObject([{ userId: w.D.userId, role: "owner" }]);
    const notices = await w.db.select().from(notification).where(eq(notification.kind, "request.accepted"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: w.R.userId, href: `/requests/${w.request.id}` });
    const log = await w.db.select().from(requestLog).where(eq(requestLog.requestId, w.request.id));
    expect(log.map((l) => l.field).sort()).toEqual(["project", "status"]);
  });

  it("uses the start as the deadline when there is no duration", async () => {
    const w = await world();
    await w.db.update(eventRequest).set({ durationMinutes: null }).where(eq(eventRequest.id, w.request.id));
    await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    const [proj] = await w.db.select().from(project);
    expect(proj.deadline?.getTime()).toBe(START.getTime());
  });

  it("refuses a second accept, a draft, a requester and a manager without the developer flag", async () => {
    const w = await world();
    await expect(acceptRequest(w.db, w.R, w.request.id, { mode: "create" })).rejects.toThrow(new ForbiddenError("Only admins and event developers can accept requests."));
    await expect(acceptRequest(w.db, w.M, w.request.id, { mode: "create" })).rejects.toBeInstanceOf(ForbiddenError);
    await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    await expect(acceptRequest(w.db, w.D, w.request.id, { mode: "create" })).rejects.toBeInstanceOf(ConflictError);
    const draft = await requestFixture(w.db, w.R, { title: "Draft" });
    const admin = await insertUser(w.db, { isAdmin: true });
    await expect(acceptRequest(w.db, admin, draft.id, { mode: "create" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("appends -2 on a slug collision and rolls back on a taken explicit slug", async () => {
    const w = await world();
    await createProjectFixture(w.db, "winter-party");
    expect((await acceptRequest(w.db, w.D, w.request.id, { mode: "create" })).projectSlug).toBe("winter-party-2");
    const other = await requestFixture(w.db, w.R, { status: "submitted", title: "Other", startsAt: START });
    await expect(acceptRequest(w.db, w.D, other.id, { mode: "create", projectSlug: "winter-party" })).rejects.toBeInstanceOf(ConflictError);
    expect(await w.db.select().from(project)).toHaveLength(2);
    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, other.id));
    expect(req).toMatchObject({ status: "submitted", projectId: null });
  });

  it("rolls back every insert when the last step fails", async () => {
    const w = await world();
    vi.mocked(notifyModule.notifyRequest).mockRejectedValueOnce(new Error("boom"));
    await expect(acceptRequest(w.db, w.D, w.request.id, { mode: "create" })).rejects.toThrow("boom");
    expect(await w.db.select().from(project)).toHaveLength(0);
    expect(await w.db.select().from(board)).toHaveLength(0);
    expect(await w.db.select().from(system)).toHaveLength(0);
    expect(await w.db.select().from(systemDocument)).toHaveLength(0);
    expect(await w.db.select().from(eventSpecBasis)).toHaveLength(0);
    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    expect(req).toMatchObject({ status: "submitted", projectId: null, systemId: null });
  });
});

describe("acceptRequest link", () => {
  it("links an existing system without writing a spec and sets an empty deadline", async () => {
    const w = await world();
    const p = await createProjectFixture(w.db, "demo");
    await createSystem(w.db, p.owner, "demo", { slug: "party", title: "Party" });
    await w.db.insert(projectMember).values({ projectId: p.projectId, userId: w.D.userId, role: "editor" });
    const result = await acceptRequest(w.db, w.D, w.request.id, { mode: "link", project: "demo", system: "party" });
    expect(result).toEqual({ projectSlug: "demo", systemSlug: "party", specVersion: null });
    expect(await w.db.select().from(systemDocument)).toHaveLength(0);
    expect(await w.db.select().from(eventSpecBasis)).toHaveLength(0);
    const [proj] = await w.db.select().from(project).where(eq(project.slug, "demo"));
    expect(proj.deadline?.getTime()).toBe(START.getTime() + 90 * 60_000);
    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    expect(req).toMatchObject({ status: "accepted", projectId: p.projectId });
  });

  it("keeps an existing deadline, creates a system when none is given and rejects an unknown system", async () => {
    const w = await world();
    const p = await createProjectFixture(w.db, "demo");
    const kept = new Date("2030-01-01T00:00:00Z");
    await w.db.update(project).set({ deadline: kept }).where(eq(project.id, p.projectId));
    const admin = await insertUser(w.db, { isAdmin: true });
    await expect(acceptRequest(w.db, admin, w.request.id, { mode: "link", project: "demo", system: "ghost" })).rejects.toBeInstanceOf(NotFoundError);
    const result = await acceptRequest(w.db, admin, w.request.id, { mode: "link", project: "demo" });
    expect(result).toEqual({ projectSlug: "demo", systemSlug: "event", specVersion: null });
    const [proj] = await w.db.select().from(project).where(eq(project.slug, "demo"));
    expect(proj.deadline?.getTime()).toBe(kept.getTime());
    expect((await w.db.select().from(system)).map((s) => s.slug)).toEqual(["event"]);
  });

  it("refuses a system that another request already links and an archived system or project", async () => {
    const w = await world();
    const p = await createProjectFixture(w.db, "demo");
    await createSystem(w.db, p.owner, "demo", { slug: "party", title: "Party" });
    await createSystem(w.db, p.owner, "demo", { slug: "old", title: "Old" });
    const admin = await insertUser(w.db, { isAdmin: true });
    await acceptRequest(w.db, admin, w.request.id, { mode: "link", project: "demo", system: "party" });
    const other = await requestFixture(w.db, w.R, { status: "submitted", title: "Other", startsAt: START });
    await expect(acceptRequest(w.db, admin, other.id, { mode: "link", project: "demo", system: "party" })).rejects.toThrow(new ConflictError("This system already belongs to another request."));
    await setSystemArchived(w.db, p.owner, "demo", "old", true);
    await expect(acceptRequest(w.db, admin, other.id, { mode: "link", project: "demo", system: "old" })).rejects.toBeInstanceOf(ConflictError);
    await w.db.update(project).set({ archivedAt: new Date() }).where(eq(project.id, p.projectId));
    await expect(acceptRequest(w.db, admin, other.id, { mode: "link", project: "demo" })).rejects.toBeInstanceOf(ConflictError);
    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, other.id));
    expect(req.status).toBe("submitted");
  });

  it("refuses a viewer and hides a project the actor cannot see", async () => {
    const w = await world();
    const p = await createProjectFixture(w.db, "demo");
    await addMemberFixture(w.db, p.owner, "demo", "viewer");
    await w.db.insert(projectMember).values({ projectId: p.projectId, userId: w.D.userId, role: "viewer" });
    await expect(acceptRequest(w.db, w.D, w.request.id, { mode: "link", project: "demo" })).rejects.toBeInstanceOf(ForbiddenError);
    await createProjectFixture(w.db, "secret");
    await expect(acceptRequest(w.db, w.D, w.request.id, { mode: "link", project: "secret" })).rejects.toBeInstanceOf(NotFoundError);
    const [req] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    expect(req.status).toBe("submitted");
  });
});

describe("linkableProjects", () => {
  it("lists the projects the actor edits with their systems", async () => {
    const w = await world();
    const p = await createProjectFixture(w.db, "demo");
    await createSystem(w.db, p.owner, "demo", { slug: "party", title: "Party" });
    const v = await createProjectFixture(w.db, "view-only");
    await w.db.insert(projectMember).values([
      { projectId: p.projectId, userId: w.D.userId, role: "editor" },
      { projectId: v.projectId, userId: w.D.userId, role: "viewer" },
    ]);
    expect(await linkableProjects(w.db, w.D)).toEqual([{ slug: "demo", name: "DEMO", systems: [{ slug: "party", title: "Party" }] }]);
    await expect(linkableProjects(w.db, w.R)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requestProgress", () => {
  it("is null while unlinked and counts tasks of non-archived systems", async () => {
    const w = await world();
    expect(await requestProgress(w.db, w.R, w.request.id)).toBeNull();
    const { projectSlug } = await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    const [sys] = await w.db.select().from(system);
    await w.db.insert(task).values((["todo", "doing", "blocked", "done"] as const).map((state, i) => ({ systemId: sys.id, title: state, state, sortOrder: i })));
    const second = await createSystem(w.db, w.D, projectSlug, { slug: "other", title: "Other" });
    await w.db.insert(task).values([{ systemId: second.id, title: "gone", state: "done", sortOrder: 0 }]);
    await setSystemArchived(w.db, w.D, projectSlug, "other", true);
    const result = await requestProgress(w.db, w.R, w.request.id);
    expect(result).toEqual({ total: 4, done: 1, doing: 1, blocked: 1, todo: 1, percent: 25, archived: false });
    expect(Object.keys(result!).sort()).toEqual(["archived", "blocked", "doing", "done", "percent", "todo", "total"]);
  });

  it("is 0 percent without tasks, flags an archived project and hides it from strangers", async () => {
    const w = await world();
    const { projectSlug } = await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    expect(await requestProgress(w.db, w.R, w.request.id)).toMatchObject({ total: 0, percent: 0 });
    await w.db.update(project).set({ archivedAt: new Date() }).where(eq(project.slug, projectSlug));
    expect(await requestProgress(w.db, w.R, w.request.id)).toMatchObject({ archived: true });
    const stranger = await insertUser(w.db);
    await expect(requestProgress(w.db, stranger, w.request.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updateRequest on an accepted request", () => {
  it("moves the project deadline with the event date", async () => {
    const w = await world();
    await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    const later = new Date(START.getTime() + 7 * 86_400_000);
    await updateRequest(w.db, w.R, w.request.id, { startsAt: later });
    const [proj] = await w.db.select().from(project);
    expect(proj.deadline?.getTime()).toBe(later.getTime() + 90 * 60_000);
    await updateRequest(w.db, w.R, w.request.id, { durationMinutes: 30 });
    expect((await w.db.select().from(project))[0].deadline?.getTime()).toBe(later.getTime() + 30 * 60_000);
  });
});

describe("write_spec with brief", () => {
  /** An accepted request with a spec v1 whose brief then moves to version 2. */
  async function accepted() {
    const w = await world();
    const { projectSlug, systemSlug } = await acceptRequest(w.db, w.D, w.request.id, { mode: "create" });
    await w.db.update(eventRequest).set({ briefVersion: 2 }).where(eq(eventRequest.id, w.request.id));
    const spec = (input: Record<string, unknown>) => runTool(w.db, w.D, w.tool("write_spec"), { project: projectSlug, system: systemSlug, body: "New spec", ...input });
    return { ...w, spec };
  }

  it("records a basis row with the spec version", async () => {
    const w = await accepted();
    expect(await w.spec({ brief: 2 })).toEqual({ version: 2 });
    const rows = await w.db.select().from(eventSpecBasis).orderBy(eventSpecBasis.specVersion);
    expect(rows.map((r) => [r.specVersion, r.briefVersion])).toEqual([[1, 1], [2, 2]]);
  });

  it("writes no spec version when the brief version is too high or the system has no request", async () => {
    const w = await accepted();
    await expect(w.spec({ brief: 3 })).rejects.toBeInstanceOf(InvalidError);
    expect(await w.db.select().from(systemDocument)).toHaveLength(1);
    const p = await createProjectFixture(w.db, "plain");
    await createSystem(w.db, p.owner, "plain", { slug: "s", title: "S" });
    await expect(runTool(w.db, p.owner, w.tool("write_spec"), { project: "plain", system: "s", body: "x", brief: 1 })).rejects.toBeInstanceOf(InvalidError);
    expect(await w.db.select().from(systemDocument)).toHaveLength(1);
  });
});
