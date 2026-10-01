import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventBriefVersion, eventRequest, eventSpecBasis, system, task } from "@/db/schema";
import { TOOLS } from "@/lib/tools/definitions";
import { runTool } from "@/lib/tools/registry";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser, requestFixture } from "@/test/fixtures";
import { ForbiddenError, InvalidError, NotFoundError } from "./errors";
import type { RequestForAgent } from "./request-agent";
import { answerQuestions } from "./request-questions";

/** `get_request` output with the brief union flattened for assertions. */
type Got = Omit<RequestForAgent, "brief"> & { brief: { version: number; body?: string; since?: number; diff?: { added: number } } };

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

/** A database with a requester, a developer, a stranger and a submitted request whose brief is at version 2. */
async function world() {
  const db = await createTestDb();
  const R = await insertUser(db, { name: "Requester" });
  const D = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const U = await insertUser(db, { name: "Stranger" });
  const request = await requestFixture(db, R, { status: "submitted", title: "Winter party", briefVersion: 2 });
  await db.insert(eventBriefVersion).values({ requestId: request.id, version: 1, body: "Line one\nLine two", authorUserId: R.userId });
  await db.update(eventBriefVersion).set({ body: "Line one\nLine two changed" }).where(eq(eventBriefVersion.version, 2));
  const ask = (actor = D, id = request.id) =>
    runTool(db, actor, tool("ask_requester"), {
      request: id,
      questions: [
        { type: "text", text: "What is the theme?" },
        { type: "yesno", text: "Voice chat?" },
      ],
    });
  const get = (input: Record<string, unknown> = {}, actor = D) => runTool(db, actor, tool("get_request"), { request: request.id, ...input }) as Promise<Got>;
  return { db, R, D, U, request, ask, get };
}

describe("ask_requester", () => {
  it("lets a developer ask a round", async () => {
    const w = await world();
    const round = (await w.ask()) as { number: number; questionIds: string[] };
    expect(round.number).toBe(1);
    expect(round.questionIds).toHaveLength(2);
  });

  it("refuses the requester, hides the request from strangers and drafts from developers", async () => {
    const w = await world();
    await expect(w.ask(w.R)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.ask(w.U)).rejects.toBeInstanceOf(NotFoundError);
    const draft = await requestFixture(w.db, w.R, { title: "Draft" });
    await expect(w.ask(w.D, draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("get_request", () => {
  it("returns the request with typed answers, open and not-sure questions", async () => {
    const w = await world();
    const round = (await w.ask()) as { questionIds: string[] };
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: round.questionIds[0], value: "Winter" }] });
    const open = await w.get();
    expect(open).toMatchObject({ id: w.request.id, title: "Winter party", status: "submitted", requester: { name: "Requester" }, project: null, system: null, openQuestions: 1, notSure: [], progress: null, specBasis: null });
    expect(open.fallback).toEqual([
      { key: "server-down", title: "Server dies mid-event", filled: false },
      { key: "staff-missing", title: "Key staff missing", filled: false },
      { key: "too-few-players", title: "Too few players", filled: false },
    ]);
    expect(open.brief).toMatchObject({ version: 2, body: "Line one\nLine two changed" });
    expect(open.rounds[0].questions[0]).toMatchObject({ type: "text", answer: "Winter", notSure: false, answered: true });
    expect(open.rounds[0].questions[1]).toMatchObject({ answer: null, answered: false });
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: round.questionIds[1], notSure: true }] });
    const done = await w.get();
    expect(done.openQuestions).toBe(0);
    expect(done.notSure).toEqual([{ questionId: round.questionIds[1], text: "Voice chat?" }]);
  });

  it("returns a brief diff and no body with sinceBrief", async () => {
    const w = await world();
    const res = await w.get({ sinceBrief: 1 });
    expect(res.brief.body).toBeUndefined();
    expect(res.brief).toMatchObject({ version: 2, since: 1 });
    expect(res.brief.diff!.added).toBeGreaterThan(0);
    await expect(w.get({ sinceBrief: 2 })).rejects.toBeInstanceOf(InvalidError);
  });

  it("cuts long answers and says so", async () => {
    const w = await world();
    const round = (await w.ask()) as { questionIds: string[] };
    await answerQuestions(w.db, w.R, w.request.id, { answers: [{ questionId: round.questionIds[0], value: "x".repeat(1800) }] });
    const res = await w.get();
    expect(res.truncated).toBe(true);
    const answer = res.rounds[0].questions[0].answer as string;
    expect(answer.length).toBeLessThan(600);
    expect(answer).toContain("1300");
  });

  it("is hidden from the requester and strangers, and for drafts", async () => {
    const w = await world();
    await expect(w.get({}, w.R)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.get({}, w.U)).rejects.toBeInstanceOf(NotFoundError);
    const draft = await requestFixture(w.db, w.R, { title: "Draft" });
    await expect(runTool(w.db, w.D, tool("get_request"), { request: draft.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("names the linked project and system", async () => {
    const w = await world();
    const { owner, slug, projectId } = await createProjectFixture(w.db);
    await runTool(w.db, owner, tool("create_system"), { project: slug, slug: "party", title: "Party" });
    const [sys] = await w.db.select().from(system).where(eq(system.slug, "party"));
    await w.db.update(eventRequest).set({ projectId, systemId: sys.id }).where(eq(eventRequest.id, w.request.id));
    expect(await w.get()).toMatchObject({ project: { slug }, system: { slug: "party" } });
  });

  it("returns the build progress and the latest spec basis of a linked system", async () => {
    const w = await world();
    const { owner, slug, projectId } = await createProjectFixture(w.db);
    await runTool(w.db, owner, tool("create_system"), { project: slug, slug: "party", title: "Party" });
    const [sys] = await w.db.select().from(system).where(eq(system.slug, "party"));
    await w.db.update(eventRequest).set({ projectId, systemId: sys.id }).where(eq(eventRequest.id, w.request.id));
    await w.db.insert(task).values([
      { systemId: sys.id, title: "a", state: "done", sortOrder: 0 },
      { systemId: sys.id, title: "b", state: "todo", sortOrder: 1 },
    ]);
    await w.db.insert(eventSpecBasis).values([
      { systemId: sys.id, specVersion: 1, briefVersion: 1 },
      { systemId: sys.id, specVersion: 2, briefVersion: 2 },
    ]);
    expect(await w.get()).toMatchObject({ progress: { total: 2, done: 1, todo: 1, percent: 50, archived: false }, specBasis: { specVersion: 2, briefVersion: 2 } });
  });
});

describe("write_spec brief", () => {
  it("is invalid for a system without a request", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await runTool(db, owner, tool("create_system"), { project: slug, slug: "s", title: "S" });
    await expect(runTool(db, owner, tool("write_spec"), { project: slug, system: "s", body: "Spec", brief: 1 })).rejects.toThrow(new InvalidError("This system has no request."));
  });
});
