import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { eventBriefVersion, eventRequest, eventSpecBasis, project, system, task } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { EVENT_TEMPLATE, projectSlugFromTitle } from "@/lib/event-template";
import { projectAccess, slugSchema } from "./access";
import type { Actor } from "./actor";
import { insertBoard } from "./boards";
import { appendVersion } from "./documents";
import { ConflictError, ForbiddenError, InvalidError, isUniqueViolation } from "./errors";
import { logChange } from "./log";
import { findSystem, lockProject, type SystemRow } from "./lookup";
import { insertProject, listProjects } from "./projects";
import { canAcceptRequests, canViewRequest, eventFlags, requestAccess, requestViewableBy } from "./request-access";
import { notifyRequest } from "./request-notify";
import { ensurePrepTodos } from "./request-setup";
import { eventEnd, lockRequest, logRequest, moveTo } from "./requests";
import { insertDomain, insertPhase } from "./structure";
import { insertSystem } from "./systems";

/** The spec version a request's system was written against, and the brief version it was based on. */
export interface SpecBasis {
  specVersion: number;
  briefVersion: number;
}

/** Returns the latest recorded basis of the request's spec, or null while none is recorded (no linked system, or no spec written with a brief version). */
export async function getSpecBasis(db: Executor, requestId: string): Promise<SpecBasis | null> {
  const [row] = await db
    .select({ specVersion: eventSpecBasis.specVersion, briefVersion: eventSpecBasis.briefVersion })
    .from(eventRequest)
    .innerJoin(eventSpecBasis, eq(eventSpecBasis.systemId, eventRequest.systemId))
    .where(eq(eventRequest.id, requestId))
    .orderBy(desc(eventSpecBasis.specVersion))
    .limit(1);
  return row ?? null;
}

/**
 * Records that the spec of `system` at `specVersion` is based on `briefVersion` of its request. It runs in the transaction
 * that writes the spec, so a spec version never exists without its basis.
 *
 * @throws InvalidError when the system belongs to no request or the request has no such brief version
 */
export async function recordSpecBasis(tx: Tx, system: SystemRow, specVersion: number, briefVersion: number): Promise<void> {
  const [request] = await tx.select({ current: eventRequest.briefVersion }).from(eventRequest).where(eq(eventRequest.systemId, system.id)).limit(1);
  if (!request) throw new InvalidError("This system has no request.");
  if (briefVersion > request.current) throw new InvalidError(`The request has no brief version ${briefVersion}.`);
  await tx.insert(eventSpecBasis).values({ systemId: system.id, specVersion, briefVersion });
}

/** Input of {@link acceptRequest}: create a project from the request, or link an existing project (and system). */
export const acceptInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create"), projectName: z.string().trim().min(1).max(100).optional(), projectSlug: slugSchema.optional(), systemSlug: slugSchema.optional() }),
  z.object({ mode: z.literal("link"), project: slugSchema, system: slugSchema.optional() }),
]);

/** Where an accepted request landed; `specVersion` is null when no spec was written (linking an existing system). */
export interface AcceptResult {
  projectSlug: string;
  systemSlug: string;
  specVersion: number | null;
}

/** Whether a system slug is used in the project. */
async function systemSlugTaken(tx: Executor, projectId: string, slug: string): Promise<boolean> {
  const rows = await tx.select({ id: system.id }).from(system).where(and(eq(system.projectId, projectId), eq(system.slug, slug))).limit(1);
  return rows.length > 0;
}

/** Whether a project slug is used. */
async function projectSlugTaken(tx: Executor, slug: string): Promise<boolean> {
  const rows = await tx.select({ id: project.id }).from(project).where(eq(project.slug, slug)).limit(1);
  return rows.length > 0;
}

/**
 * Accepts a submitted request into a new project built from the event template (`create`) or into an existing project the
 * actor edits (`link`), in one transaction. Admins and event developers only. A created project gets a draft spec holding the
 * brief and its system stays in planning; linking an existing system writes no spec.
 *
 * @throws ForbiddenError for anyone but admins and event developers, or a viewer of the target project
 * @throws ConflictError unless the request is submitted and unlinked, or when a slug is taken
 * @throws NotFoundError for an unknown project or system
 */
export async function acceptRequest(db: Db, actor: Actor, requestId: string, raw: z.input<typeof acceptInput>): Promise<AcceptResult> {
  const input = acceptInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      await lockRequest(tx, requestId);
      const { request, flags } = await requestAccess(tx, actor, requestId, "view");
      if (!canAcceptRequests(flags)) throw new ForbiddenError("Only admins and event developers can accept requests.");
      if (request.status !== "submitted") throw new ConflictError(`A ${request.status} request cannot be accepted.`);
      if (request.projectId) throw new ConflictError("This request already has a project.");
      const end = eventEnd(request);
      let projectId: string;
      let projectSlug: string;
      let systemRow: SystemRow;
      let specVersion: number | null = null;

      if (input.mode === "create") {
        projectSlug = input.projectSlug ?? (await projectSlugFromTitle(request.title, (s) => projectSlugTaken(tx, s)));
        if (await projectSlugTaken(tx, projectSlug)) throw new ConflictError(`Project slug ${projectSlug} is taken.`);
        const created = await insertProject(tx, actor, { slug: projectSlug, name: input.projectName ?? request.title, description: "", repoUrl: null }, end);
        projectId = created.id;
        await insertBoard(tx, projectId, EVENT_TEMPLATE.board, 0);
        const build = await insertPhase(tx, projectId, { name: EVENT_TEMPLATE.phases[0] });
        for (const name of EVENT_TEMPLATE.phases.slice(1)) await insertPhase(tx, projectId, { name });
        const domain = await insertDomain(tx, projectId, { name: EVENT_TEMPLATE.domain });
        systemRow = await insertSystem(tx, actor, projectSlug, {
          slug: input.systemSlug ?? "event",
          title: request.title,
          summary: "",
          domainId: domain.id,
          phaseId: build.id,
          priority: EVENT_TEMPLATE.priority,
        });
        const [brief] = await tx
          .select({ body: eventBriefVersion.body })
          .from(eventBriefVersion)
          .where(and(eq(eventBriefVersion.requestId, requestId), eq(eventBriefVersion.version, request.briefVersion)));
        specVersion = await appendVersion(tx, actor, systemRow, "spec", brief?.body ?? "");
        await tx.insert(eventSpecBasis).values({ systemId: systemRow.id, specVersion, briefVersion: request.briefVersion });
      } else {
        const { project: target } = await projectAccess(tx, actor, input.project, "editor");
        projectId = target.id;
        projectSlug = target.slug;
        if (input.system) {
          systemRow = await findSystem(tx, target.id, input.system, true);
          const [linked] = await tx.select({ id: eventRequest.id }).from(eventRequest).where(eq(eventRequest.systemId, systemRow.id)).limit(1);
          if (linked) throw new ConflictError("This system already belongs to another request.");
        } else {
          systemRow = await insertSystem(tx, actor, target.slug, {
            slug: await projectSlugFromTitle("event", (s) => systemSlugTaken(tx, target.id, s)),
            title: request.title,
            summary: "",
            domainId: null,
            phaseId: null,
            priority: EVENT_TEMPLATE.priority,
          });
        }
        if (end && !target.deadline) {
          await lockProject(tx, target.id);
          await tx.update(project).set({ deadline: end }).where(eq(project.id, target.id));
          await logChange(tx, actor, { projectId: target.id, entity: "project", entityId: target.id, field: "deadline", newValue: end.toISOString() });
        }
      }

      const accepted = await moveTo(tx, actor, request, "accepted", { projectId, systemId: systemRow.id, acceptedAt: new Date(), acceptedBy: actor.userId, projectCreated: input.mode === "create" });
      await ensurePrepTodos(tx, accepted, actor.userId);
      await logRequest(tx, actor, { requestId, field: "project", newValue: projectSlug });
      if (request.requesterId) {
        await notifyRequest(tx, {
          requestId,
          kind: "request.accepted",
          userIds: [request.requesterId],
          title: { key: "requestAccepted", values: { title: request.title } },
          sourceKey: `req:${requestId}:accepted`,
          actor,
        });
      }
      return { projectSlug, systemSlug: systemRow.slug, specVersion };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A project or system with that slug already exists.");
    throw error;
  }
}

/** The build progress of a request: task counts of the linked project, never task titles. */
export interface RequestProgress {
  total: number;
  done: number;
  doing: number;
  blocked: number;
  todo: number;
  /** `done / total` as a rounded percentage; 0 without tasks. */
  percent: number;
  /** True when the project is archived; the counts are then the last ones. */
  archived: boolean;
}

/**
 * Counts the tasks of all non-archived systems of the request's project by state. Anyone who may view the request gets the
 * counts and nothing else, so a requester outside the project learns no task titles.
 *
 * @returns null while the request has no project
 * @throws NotFoundError when the actor may not view the request
 */
export async function requestProgress(db: Executor, actor: Actor, requestId: string): Promise<RequestProgress | null> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  if (!request.projectId) return null;
  const [[linked], rows] = await Promise.all([
    db.select({ archivedAt: project.archivedAt }).from(project).where(eq(project.id, request.projectId)),
    db
      .select({ state: task.state, n: sql<number>`count(*)::int` })
      .from(task)
      .innerJoin(system, eq(system.id, task.systemId))
      .where(and(eq(system.projectId, request.projectId), isNull(system.archivedAt)))
      .groupBy(task.state),
  ]);
  const count = (state: string) => rows.find((r) => r.state === state)?.n ?? 0;
  const [done, doing, blocked, todo] = [count("done"), count("doing"), count("blocked"), count("todo")];
  const total = done + doing + blocked + todo;
  return { total, done, doing, blocked, todo, percent: total === 0 ? 0 : Math.round((done / total) * 100), archived: linked?.archivedAt != null };
}

/** A project a request can be linked to, with its systems. */
export interface LinkableProject {
  slug: string;
  name: string;
  systems: { slug: string; title: string }[];
}

/**
 * Lists the projects where the actor is an editor or higher (every active project for admins), each with its systems, for the
 * "Link to an existing project" picker. Admins and event developers only.
 *
 * @throws ForbiddenError for everyone else
 */
export async function linkableProjects(db: Db, actor: Actor): Promise<LinkableProject[]> {
  if (!canAcceptRequests(await eventFlags(db, actor))) throw new ForbiddenError("Only admins and event developers can accept requests.");
  const projects = (await listProjects(db, actor)).filter((p) => p.role !== "viewer");
  const result: LinkableProject[] = [];
  for (const p of projects) {
    const systems = await db
      .select({ slug: system.slug, title: system.title })
      .from(system)
      .where(and(eq(system.projectId, p.id), isNull(system.archivedAt)))
      .orderBy(system.sortOrder);
    result.push({ slug: p.slug, name: p.name, systems });
  }
  return result;
}

/** The request a project was built for. */
export interface ProjectRequest {
  id: string;
  title: string;
  /** Whether the actor may open the request page; otherwise the project only shows a plain chip. */
  canView: boolean;
}

/**
 * Returns the (first) request linked to the project, for the "From event request" chip, or null.
 *
 * @throws NotFoundError when the actor may not see the project
 */
export async function requestOfProject(db: Executor, actor: Actor, projectSlug: string): Promise<ProjectRequest | null> {
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const [row] = await db
    .select({ id: eventRequest.id, title: eventRequest.title, canView: sql<boolean>`${requestViewableBy(db, actor.userId, eventRequest.id)}` })
    .from(eventRequest)
    .where(eq(eventRequest.projectId, found.id))
    .orderBy(asc(eventRequest.acceptedAt), asc(eventRequest.id))
    .limit(1);
  return row ?? null;
}

/** Whether a request's spec still matches its brief. */
export interface BriefStatus {
  requestId: string;
  /** The request title, only when the actor may view the request. */
  requestTitle: string | null;
  /** The slug of the request's system, for showing the banner on that system's page only. */
  systemSlug: string | null;
  briefVersion: number;
  /** The spec version the latest basis was recorded for; null while no basis exists. */
  specVersion: number | null;
  basisBriefVersion: number | null;
  /** `changed`: the brief moved on since the spec's basis; `not_applied`: no basis (linked to an existing system); else `current`. */
  state: "current" | "changed" | "not_applied";
  /** The number of brief versions since the basis; 0 unless `changed`. */
  changeCount: number;
}

/** Builds the status of a request row for an actor who may see its project. */
async function statusOf(db: Executor, request: typeof eventRequest.$inferSelect, viewable: boolean): Promise<BriefStatus> {
  const basis = await getSpecBasis(db, request.id);
  const [linked] = request.systemId ? await db.select({ slug: system.slug }).from(system).where(eq(system.id, request.systemId)) : [];
  const changed = basis !== null && basis.briefVersion < request.briefVersion;
  return {
    requestId: request.id,
    requestTitle: viewable ? request.title : null,
    systemSlug: linked?.slug ?? null,
    briefVersion: request.briefVersion,
    specVersion: basis?.specVersion ?? null,
    basisBriefVersion: basis?.briefVersion ?? null,
    state: basis === null ? "not_applied" : changed ? "changed" : "current",
    changeCount: changed ? request.briefVersion - basis.briefVersion : 0,
  };
}

/**
 * The brief status of the request linked to a project, for every member of the project; the title is hidden from those who
 * may not view the request.
 *
 * @returns null when the project has no request
 * @throws NotFoundError when the actor may not see the project
 */
export async function briefStatusForProject(db: Executor, actor: Actor, projectSlug: string): Promise<BriefStatus | null> {
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const [request] = await db.select().from(eventRequest).where(eq(eventRequest.projectId, found.id)).orderBy(asc(eventRequest.acceptedAt), asc(eventRequest.id)).limit(1);
  if (!request) return null;
  return statusOf(db, request, await canViewRequest(db, actor.userId, request.id));
}

/**
 * The brief status of a request the actor may view.
 *
 * @throws NotFoundError when the actor may not view the request
 */
export async function briefStatusForRequest(db: Executor, actor: Actor, requestId: string): Promise<BriefStatus> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  return statusOf(db, request, true);
}

/** The brief status by project slug or by request id; null when the project has no request. */
export function briefStatus(db: Executor, actor: Actor, by: { projectSlug: string } | { requestId: string }): Promise<BriefStatus | null> {
  return "projectSlug" in by ? briefStatusForProject(db, actor, by.projectSlug) : briefStatusForRequest(db, actor, by.requestId);
}
