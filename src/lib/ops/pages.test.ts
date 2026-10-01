import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, pageVersion } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { comparePages, deletePage, getPage, listPages, writePage } from "./pages";

describe("project pages", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    return { db, owner, slug };
  }

  it("creates a page with a title, then appends versions keeping the title", async () => {
    const { db, owner, slug } = await setup();
    expect(await writePage(db, owner, slug, { page: "onboarding", title: "Onboarding", body: "# one" })).toEqual({ version: 1, created: true });
    expect(await writePage(db, owner, slug, { page: "onboarding", body: "# two" })).toEqual({ version: 2, created: false });
    expect(await listPages(db, owner, slug)).toMatchObject([{ slug: "onboarding", title: "Onboarding", version: 2, authorName: "Owner", agent: null }]);
  });

  it("renames a page when the title differs and logs it", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "p", title: "Old", body: "a" });
    await writePage(db, owner, slug, { page: "p", title: "New", body: "b" });
    const log = await db.select().from(changeLog).where(eq(changeLog.field, "title"));
    expect(log.map((l) => [l.entity, l.oldValue, l.newValue])).toEqual([["page", "Old", "New"]]);
  });

  it("needs a title for a new page", async () => {
    const { db, owner, slug } = await setup();
    await expect(writePage(db, owner, slug, { page: "p", body: "a" })).rejects.toMatchObject({ status: 400, message: "title is required for a new page." });
  });

  it("gives parallel writers distinct consecutive versions", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "p", title: "P", body: "a" });
    const results = await Promise.all([writePage(db, owner, slug, { page: "p", body: "b" }), writePage(db, owner, slug, { page: "p", body: "c" })]);
    expect(results.map((r) => r.version).sort()).toEqual([2, 3]);
  });

  it("creates a page once when two writers race on a new slug", async () => {
    const { db, owner, slug } = await setup();
    const results = await Promise.all([writePage(db, owner, slug, { page: "p", title: "P", body: "a" }), writePage(db, owner, slug, { page: "p", title: "P", body: "b" })]);
    expect(results.map((r) => r.version).sort()).toEqual([1, 2]);
    expect((await listPages(db, owner, slug)).length).toBe(1);
  });

  it("refuses a write on a stale base version", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "p", title: "P", body: "a" });
    await writePage(db, owner, slug, { page: "p", body: "b", baseVersion: 1 });
    await expect(writePage(db, owner, slug, { page: "p", body: "c", baseVersion: 1 })).rejects.toMatchObject({
      status: 409,
      message: "Page p changed since you opened it (now v2). Copy your text, reload and apply it again.",
    });
    expect((await writePage(db, owner, slug, { page: "p", body: "c", baseVersion: 2 })).version).toBe(3);
  });

  it("refuses to create a page over an existing one", async () => {
    const { db, owner, slug } = await setup();
    expect(await writePage(db, owner, slug, { page: "p", title: "P", body: "a", create: true })).toEqual({ version: 1, created: true });
    await expect(writePage(db, owner, slug, { page: "p", title: "Other", body: "b", create: true })).rejects.toMatchObject({ status: 409, message: "Page p already exists." });
    expect(await listPages(db, owner, slug)).toMatchObject([{ slug: "p", title: "P", version: 1 }]);
  });

  it("returns a given version, the latest, or only the diff since a version", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "p", title: "P", body: "alpha" });
    await writePage(db, owner, slug, { page: "p", body: "beta" });
    expect((await getPage(db, owner, slug, "p", 1)).body).toBe("alpha");
    expect(await getPage(db, owner, slug, "p")).toMatchObject({ version: 2, body: "beta", versions: [2, 1], title: "P" });
    const changes = await getPage(db, owner, slug, "p", undefined, 1);
    expect(changes.diff).toContain("+beta");
    expect(changes).not.toHaveProperty("body");
    await expect(getPage(db, owner, slug, "p", undefined, 2)).rejects.toMatchObject({ status: 400 });
    await expect(getPage(db, owner, slug, "p", 9)).rejects.toMatchObject({ status: 404 });
    await expect(getPage(db, owner, slug, "nope")).rejects.toMatchObject({ status: 404, message: "Unknown page nope." });
  });

  it("compares two versions", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "p", title: "P", body: "a" });
    await writePage(db, owner, slug, { page: "p", body: "b" });
    const c = await comparePages(db, owner, slug, "p", 1, 2);
    expect(c).toMatchObject({ added: 1, removed: 1 });
    expect([c.from.version, c.to.version]).toEqual([1, 2]);
    await expect(comparePages(db, owner, slug, "p", 2, 1)).rejects.toMatchObject({ status: 400 });
  });

  it("lets viewers read and editors write, but only owners delete", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await expect(writePage(db, viewer, slug, { page: "p", title: "P", body: "a" })).rejects.toMatchObject({ status: 403 });
    await writePage(db, editor, slug, { page: "p", title: "P", body: "a" });
    expect(await listPages(db, viewer, slug)).toHaveLength(1);
    await expect(deletePage(db, editor, slug, "p")).rejects.toMatchObject({ status: 403 });
  });

  it("deletes a page with its versions and logs the whole life", async () => {
    const { db, owner, slug } = await setup();
    await writePage(db, owner, slug, { page: "p", title: "P", body: "a" });
    await writePage(db, owner, slug, { page: "p", body: "b" });
    await deletePage(db, owner, slug, "p");
    expect(await db.select().from(pageVersion)).toHaveLength(0);
    expect(await listPages(db, owner, slug)).toEqual([]);
    await expect(deletePage(db, owner, slug, "p")).rejects.toMatchObject({ status: 404 });
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, "page")).orderBy(asc(changeLog.id));
    expect(log.map((l) => [l.field, l.newValue ?? l.oldValue])).toEqual([
      ["created", "P"],
      ["version", "v2"],
      ["deleted", "P"],
    ]);
  });
});
