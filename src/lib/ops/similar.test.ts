import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { TOOLS } from "@/lib/tools/definitions";
import { runTool } from "@/lib/tools/registry";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { setSystemArchived } from "./archive";
import { NotFoundError } from "./errors";
import { SIMILARITY_THRESHOLD, similarSystems } from "./similar";
import { createSystem } from "./systems";

describe("similarSystems", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "search-index", title: "Search index" });
    await createSystem(db, owner, slug, { slug: "billing-exports", title: "Billing exports" });
    return { db, owner, slug };
  }

  it("finds the closest title first with its score", async () => {
    const { db, owner, slug } = await setup();
    const found = await similarSystems(db, owner, slug, { title: "search indexer" });
    expect(found[0]).toMatchObject({ slug: "search-index", title: "Search index", archived: false });
    expect(found[0].score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    expect(found.map((s) => s.slug)).not.toContain("billing-exports");
  });

  it("returns nothing for an unrelated title", async () => {
    const { db, owner, slug } = await setup();
    expect(await similarSystems(db, owner, slug, { title: "Payroll" })).toEqual([]);
  });

  it("rejects a title shorter than three characters", async () => {
    const { db, owner, slug } = await setup();
    await expect(similarSystems(db, owner, slug, { title: "ab" })).rejects.toBeInstanceOf(ZodError);
  });

  it("includes archived systems, flagged", async () => {
    const { db, owner, slug } = await setup();
    await setSystemArchived(db, owner, slug, "search-index", true);
    const found = await similarSystems(db, owner, slug, { title: "search indexer" });
    expect(found[0]).toMatchObject({ slug: "search-index", archived: true });
  });

  it("hides the project from a non-member", async () => {
    const { db, slug } = await setup();
    const { owner: stranger } = await createProjectFixture(db, "other");
    await expect(similarSystems(db, stranger, slug, { title: "search indexer" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a viewer look up similar titles", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect((await similarSystems(db, viewer, slug, { title: "search indexer" }))[0].slug).toBe("search-index");
  });

  it("is returned by create_system without the created system itself", async () => {
    const { db, owner, slug } = await setup();
    const create = TOOLS.find((t) => t.name === "create_system")!;
    const result = (await runTool(db, owner, create, { project: slug, slug: "search-indexes", title: "Search indexes" })) as {
      slug: string;
      similar: { slug: string }[];
    };
    expect(result.slug).toBe("search-indexes");
    expect(result.similar[0].slug).toBe("search-index");
    expect(result.similar.map((s) => s.slug)).not.toContain("search-indexes");
  });
});
