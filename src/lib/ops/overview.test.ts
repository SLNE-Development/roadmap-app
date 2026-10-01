import { describe, expect, it } from "vitest";
import { githubRepo } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { createAdr } from "./adrs";
import { upsertCodeLink } from "./github-links";
import { writeSpec } from "./documents";
import { getSystemOverview } from "./overview";
import { addPlanningRound } from "./planning";
import { addQuestion } from "./questions";
import { createSystem } from "./systems";
import { postUpdate } from "./updates";

describe("getSystemOverview", () => {
  it("combines system, documents, planning state, questions, ADRs and updates", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    await addPlanningRound(db, owner, slug, "s", { items: [{ area: "scope", question: "?" }] });
    await addQuestion(db, owner, slug, { title: "Q?", system: "s" });
    await createAdr(db, owner, slug, { title: "A", context: "c", decision: "d", alternatives: "a", consequences: "q", systems: ["s"] });
    await postUpdate(db, owner, slug, "s", { summary: "Started" });
    const o = await getSystemOverview(db, owner, slug, "s");
    expect(o.spec?.body).toBe("# Spec");
    expect(o.plan).toBeNull();
    expect(o.planning).toMatchObject({ complete: false, rounds: 1 });
    expect(o.planning.gaps.length).toBeGreaterThan(0);
    expect(o.questions.map((q) => q.title)).toEqual(["Q?"]);
    expect(o.adrs.map((a) => a.number)).toEqual([1]);
    expect(o.updates.map((u) => u.summary)).toEqual(["Started"]);
    expect(o.code).toEqual([]);
  });

  it("lists the code links, newest first", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const sys = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await db.insert(githubRepo).values({ id: "r1", projectId, fullName: "Org/App", fullNameKey: "org/app", mode: "app" });
    for (const number of [1, 2]) {
      await upsertCodeLink(db, {
        projectId, systemId: sys.id, taskId: null, repoId: "r1", kind: "pr", number, sha: "abc", title: `PR ${number}`,
        url: `https://github.com/Org/App/pull/${number}`, state: "open", closes: false, authorLogin: null,
      });
    }
    const o = await getSystemOverview(db, owner, slug, "s");
    expect(o.code.map((c) => c.number)).toEqual([2, 1]);
    expect(o.code).toHaveLength(2);
  });
});
