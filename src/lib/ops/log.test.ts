import { describe, expect, it } from "vitest";
import { changeLog, project } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { withAgent } from "./actor";
import { logChange } from "./log";

describe("logChange", () => {
  it("records the change with the actor and agent", async () => {
    const db = await createTestDb();
    const actor = withAgent(await insertUser(db, { name: "Alex" }), "Claude Code");
    await db.insert(project).values({ id: "p1", slug: "p", name: "P" });
    await logChange(db, actor, { projectId: "p1", entity: "task", entityId: 7, field: "state", oldValue: "todo", newValue: "done" });
    const [row] = await db.select().from(changeLog);
    expect(row).toMatchObject({
      projectId: "p1",
      systemId: null,
      entity: "task",
      entityId: "7",
      field: "state",
      oldValue: "todo",
      newValue: "done",
      authorUserId: actor.userId,
      agent: "Claude Code",
    });
  });
});
