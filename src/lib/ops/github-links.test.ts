import { describe, expect, it } from "vitest";
import { codeLink, githubAccount, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { evaluateGates, GATE_RULES, listGateRules, type GateSubject } from "./gates";
import { linksForSystem, upsertCodeLink } from "./github-links";
import { NotFoundError } from "./errors";
import { createSystem } from "./systems";
import { addTask } from "./tasks";

async function setup() {
  const db = await createTestDb();
  const p = await createProjectFixture(db, "p");
  const system = await createSystem(db, p.owner, "p", { slug: "search", title: "Search" });
  const { id: taskId } = await addTask(db, p.owner, "p", "search", { title: "Results" });
  await db.insert(githubRepo).values({ id: "r1", projectId: p.projectId, fullName: "Org/App", fullNameKey: "org/app", mode: "app", githubRepoId: 42 });
  const subject: GateSubject = { id: system.id, slug: "search", projectId: p.projectId };
  const link = (state: "open" | "closed" | "merged", extra: { number?: number; authorLogin?: string | null; checks?: "pending" | "success" | "failure" } = {}) =>
    upsertCodeLink(db, {
      projectId: p.projectId,
      systemId: system.id,
      taskId,
      repoId: "r1",
      kind: "pr",
      number: extra.number ?? 419,
      sha: "abc",
      title: "feat: results",
      url: "https://github.com/Org/App/pull/419",
      state,
      checks: extra.checks,
      closes: false,
      authorLogin: extra.authorLogin ?? "octo",
    });
  return { db, p, subject, link };
}

/** The reason each registered PR rule gives for the subject, null when met. */
async function reasons(db: Db, subject: GateSubject) {
  const out: Record<string, string | null> = {};
  for (const id of ["pr-open", "pr-merged"]) {
    const result = await evaluateGates(db, [subject], "Review", [{ rule: id, param: null }], new Date());
    out[id] = result.get(subject.id)?.unmet[0] ?? null;
  }
  return out;
}

describe("pull request gate rules", () => {
  it("are registered with their labels and need a GitHub repository", () => {
    expect(GATE_RULES.get("pr-open")?.label(null)).toBe("An open or merged pull request");
    expect(GATE_RULES.get("pr-merged")?.label(null)).toBe("A merged pull request");
    expect(listGateRules().find((r) => r.id === "pr-open")?.note).toBe("needs a linked GitHub repository");
    expect(listGateRules().find((r) => r.id === "all-tasks-done")?.note).toBeUndefined();
  });

  it("fail without links", async () => {
    const { db, subject } = await setup();
    expect(await reasons(db, subject)).toEqual({ "pr-open": "no open or merged pull request", "pr-merged": "no merged pull request" });
  });

  it("pass pr-open for an open pull request linked through a task, not pr-merged", async () => {
    const { db, subject, link } = await setup();
    await link("open");
    expect(await reasons(db, subject)).toEqual({ "pr-open": null, "pr-merged": "no merged pull request" });
  });

  it("pass both once the pull request is merged", async () => {
    const { db, subject, link } = await setup();
    await link("open");
    await link("merged");
    expect(await reasons(db, subject)).toEqual({ "pr-open": null, "pr-merged": null });
  });

  it("fail both for a pull request closed without merging", async () => {
    const { db, subject, link } = await setup();
    await link("closed");
    expect(await reasons(db, subject)).toEqual({ "pr-open": "no open or merged pull request", "pr-merged": "no merged pull request" });
  });

  it("ignore commits", async () => {
    const { db, subject, p } = await setup();
    await db.insert(codeLink).values({
      id: "c1", projectId: p.projectId, systemId: subject.id, repoId: "r1", kind: "commit", refKey: "commit:abc", targetKey: `system:${subject.id}`,
      sha: "abc", title: "fix", url: "https://github.com/Org/App/commit/abc", state: "merged",
    });
    expect((await reasons(db, subject))["pr-open"]).toBe("no open or merged pull request");
  });
});

describe("linksForSystem", () => {
  it("resolves the author name through the linked GitHub account", async () => {
    const { db, link, p } = await setup();
    await link("open", { authorLogin: "Octo" });
    const person = await insertUser(db, { name: "Octavia" });
    await db.insert(githubAccount).values({ userId: person.userId, githubId: 7, login: "octo" });
    const [view] = await linksForSystem(db, p.owner, "p", "search");
    expect(view).toMatchObject({ number: 419, state: "open", authorLogin: "Octo", authorName: "Octavia", repoFullName: "Org/App" });
  });

  it("leaves authorName null without a linked account", async () => {
    const { db, link, p } = await setup();
    await link("open");
    const [view] = await linksForSystem(db, p.owner, "p", "search");
    expect(view.authorName).toBeNull();
  });

  it("throws NotFoundError for a non-member", async () => {
    const { db } = await setup();
    const stranger = await insertUser(db, { name: "Stranger" });
    await expect(linksForSystem(db, stranger, "p", "search")).rejects.toBeInstanceOf(NotFoundError);
  });
});
