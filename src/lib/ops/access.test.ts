import { describe, expect, it } from "vitest";
import { project, projectMember } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { projectAccess } from "./access";

describe("projectAccess", () => {
  it("reports projects the actor is not a member of as not found", async () => {
    const db = await createTestDb();
    const outsider = await insertUser(db);
    await db.insert(project).values({ id: "p1", slug: "demo", name: "Demo" });
    await expect(projectAccess(db, outsider, "demo", "viewer")).rejects.toMatchObject({ status: 404, message: "Unknown project demo." });
    await expect(projectAccess(db, outsider, "nope", "viewer")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a role that is too low with 403", async () => {
    const db = await createTestDb();
    const viewer = await insertUser(db);
    await db.insert(project).values({ id: "p1", slug: "demo", name: "Demo" });
    await db.insert(projectMember).values({ projectId: "p1", userId: viewer.userId, role: "viewer" });
    expect((await projectAccess(db, viewer, "demo", "viewer")).role).toBe("viewer");
    await expect(projectAccess(db, viewer, "demo", "editor")).rejects.toMatchObject({
      status: 403,
      message: "This needs the editor role in project demo; you are viewer.",
    });
  });

  it("gives admins owner rights in every project", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await db.insert(project).values({ id: "p1", slug: "demo", name: "Demo" });
    expect((await projectAccess(db, admin, "demo", "owner")).role).toBe("admin");
  });
});
