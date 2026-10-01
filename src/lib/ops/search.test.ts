import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { system } from "@/db/schema";
import { TOOLS } from "@/lib/tools/definitions";
import { runTool } from "@/lib/tools/registry";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { createAdr } from "./adrs";
import { writeSpec } from "./documents";
import { NotFoundError } from "./errors";
import { writePage } from "./pages";
import { addQuestion } from "./questions";
import { searchProject } from "./search";
import { createSystem } from "./systems";

describe("searchProject", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "search-index", title: "Search index", summary: "rebuild on every write" });
    await writeSpec(db, owner, slug, "search-index", { body: "old wording nightly" });
    await writeSpec(db, owner, slug, "search-index", { body: "rebuild in the transaction" });
    await createAdr(db, owner, slug, { title: "Use SSE for live boards", context: "Boards update live.", decision: "Server-sent events.", alternatives: "Polling.", consequences: "One open stream per tab." });
    await addQuestion(db, owner, slug, { title: "Should exports include archived rows?" });
    await writePage(db, owner, slug, { page: "onboarding", title: "Onboarding", body: "run npm ci" });
    return { db, owner, slug };
  }

  it("finds the system and only the latest spec, with a marked snippet", async () => {
    const { db, owner, slug } = await setup();
    const hits = await searchProject(db, owner, slug, { q: "rebuil" });
    expect(hits.map((h) => h.kind).sort()).toEqual(["spec", "system"]);
    const spec = hits.find((h) => h.kind === "spec")!;
    expect(spec).toMatchObject({ title: "Search index", href: "/p/demo/systems/search-index?tab=spec" });
    expect(spec.snippet).toContain("\u0002rebuild\u0003");
    expect(spec.snippet).not.toContain("nightly");
    expect(hits.find((h) => h.kind === "system")).toMatchObject({ title: "Search index", href: "/p/demo/systems/search-index" });
  });

  it("does not match words only an older version has", async () => {
    const { db, owner, slug } = await setup();
    expect((await searchProject(db, owner, slug, { q: "nightly" })).filter((h) => h.kind === "spec")).toEqual([]);
  });

  it("finds an ADR by its title", async () => {
    const { db, owner, slug } = await setup();
    const hits = await searchProject(db, owner, slug, { q: "sse" });
    expect(hits).toMatchObject([{ kind: "adr", title: "Use SSE for live boards", href: "/p/demo/adrs/1" }]);
  });

  it("finds a page by its body", async () => {
    const { db, owner, slug } = await setup();
    expect(await searchProject(db, owner, slug, { q: "npm" })).toMatchObject([{ kind: "page", title: "Onboarding", href: "/p/demo/pages/onboarding" }]);
  });

  it("finds a page by its title", async () => {
    const { db, owner, slug } = await setup();
    expect(await searchProject(db, owner, slug, { q: "onboard" })).toMatchObject([{ kind: "page", href: "/p/demo/pages/onboarding" }]);
  });

  it("keeps only the requested kinds", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "exports", title: "Exports", body: "exports run nightly" });
    const hits = await searchProject(db, owner, slug, { q: "exports", kinds: ["question"] });
    expect(hits).toMatchObject([{ kind: "question", title: "Should exports include archived rows?", href: "/p/demo/questions" }]);
  });

  it("links a question of a system to the questions filtered by it", async () => {
    const { db, owner, slug } = await setup();
    await addQuestion(db, owner, slug, { title: "How often to compact?", system: "search-index" });
    expect(await searchProject(db, owner, slug, { q: "compact" })).toMatchObject([{ kind: "question", href: "/p/demo/questions?system=search-index" }]);
  });

  it("runs only the access check for a query without a usable word", async () => {
    const { db, owner, slug } = await setup();
    const { owner: stranger } = await createProjectFixture(db, "other");
    let selects = 0;
    // Counts the access check's select and fails on any search query.
    const stub = new Proxy(db, {
      get(target, prop) {
        if (prop === "execute") return () => Promise.reject(new Error("search query issued"));
        const value = Reflect.get(target, prop, target);
        if (prop === "select") return (...args: unknown[]) => (selects++, value.apply(target, args));
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await searchProject(stub, owner, slug, { q: "a" })).toEqual([]);
    expect(selects).toBe(1);
    await expect(searchProject(stub, stranger, slug, { q: "a" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never fails on tsquery syntax", async () => {
    const { db, owner, slug } = await setup();
    expect((await searchProject(db, owner, slug, { q: "sse:* & !(boards | <->" })).map((h) => h.kind)).toEqual(["adr"]);
    expect(await searchProject(db, owner, slug, { q: "'&|!:*()<>" })).toEqual([]);
  });

  it("lets a viewer search", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect((await searchProject(db, viewer, slug, { q: "npm" })).map((h) => h.kind)).toEqual(["page"]);
  });

  it("hides the project from a non-member", async () => {
    const { db, slug } = await setup();
    const { owner: stranger } = await createProjectFixture(db, "other");
    await expect(searchProject(db, stranger, slug, { q: "npm" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("leaves out archived systems with their documents and questions", async () => {
    const { db, owner, slug } = await setup();
    await createSystem(db, owner, slug, { slug: "old-export", title: "Old export", summary: "compaction job" });
    await writeSpec(db, owner, slug, "old-export", { body: "compaction runs weekly" });
    await addQuestion(db, owner, slug, { title: "Keep compaction logs?", system: "old-export" });
    await db.update(system).set({ archivedAt: new Date() }).where(eq(system.slug, "old-export"));
    expect(await searchProject(db, owner, slug, { q: "compaction" })).toEqual([]);
  });

  it("orders by rank and honours the limit", async () => {
    const { db, owner, slug } = await setup();
    const hits = await searchProject(db, owner, slug, { q: "rebuil", limit: 1 });
    expect(hits).toHaveLength(1);
    const all = await searchProject(db, owner, slug, { q: "rebuil" });
    expect(all.map((h) => h.rank)).toEqual([...all.map((h) => h.rank)].sort((a, b) => b - a));
    expect(hits[0]).toEqual(all[0]);
  });
  it("is returned by the search tool with refs and ** markers instead of links", async () => {
    const { db, owner, slug } = await setup();
    const { id } = await addQuestion(db, owner, slug, { title: "Rebuild nightly too?" });
    const search = TOOLS.find((t) => t.name === "search")!;
    const hits = (await runTool(db, owner, search, { project: slug, q: "rebuil", kinds: "spec,question", limit: "5" })) as Record<string, string>[];
    expect(hits.map((h) => Object.keys(h).sort())).toEqual([
      ["kind", "ref", "snippet", "title"],
      ["kind", "ref", "snippet", "title"],
    ]);
    expect(hits.find((h) => h.kind === "spec")).toEqual({ kind: "spec", title: "Search index", ref: "search-index", snippet: "**rebuild** in the transaction" });
    expect(hits.find((h) => h.kind === "question")?.ref).toBe(id);
    const adrs = (await runTool(db, owner, search, { project: slug, q: "sse" })) as Record<string, string>[];
    expect(adrs).toMatchObject([{ kind: "adr", ref: "1" }]);
  });
  it("keeps the search vector out of system rows returned by tools", async () => {
    const { db, owner, slug } = await setup();
    const run = (name: string, input: object) => runTool(db, owner, TOOLS.find((t) => t.name === name)!, { project: slug, ...input });
    for (const result of [await run("create_system", { slug: "other", title: "Other" }), await run("update_system", { system: "other", summary: "x" }), await run("get_system", { system: "other" })]) {
      expect(JSON.stringify(result)).not.toContain('"search"');
    }
  });
});
