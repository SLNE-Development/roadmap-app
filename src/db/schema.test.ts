import { describe, expect, it } from "vitest";
import { board, project } from "@/db/schema";
import { isUniqueViolation } from "@/lib/ops/errors";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";

describe("schema", () => {
  it("applies the migrations to an empty database", async () => {
    const db = await createTestDb();
    const rows = await db.select().from(project);
    expect(rows).toEqual([]);
  });

  it("rejects two boards with the same slug in one project", async () => {
    const db = await createTestDb();
    await insertUser(db);
    await db.insert(project).values({ id: "p1", slug: "p", name: "P" });
    await db.insert(board).values({ id: "b1", projectId: "p1", slug: "dev", name: "Dev", sortOrder: 0 });
    const error = await db
      .insert(board)
      .values({ id: "b2", projectId: "p1", slug: "dev", name: "Dev 2", sortOrder: 1 })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("gives every test its own database", async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    await a.insert(project).values({ id: "p1", slug: "p", name: "P" });
    expect(await b.select().from(project)).toEqual([]);
  });
});
