import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedAccount, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { resolveMentionsIn } from "./mentions";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("resolveMentionsIn", () => {
  it("resolves current members only", async () => {
    const { owner, slug, projectId } = await createProjectFixture(db);
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    const out = await resolveMentionsIn(db, projectId, "@Jules hi");
    expect(out).toContain(`user:${jules.userId}`);

    const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, jules.userId));
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, row.discordId!));
    expect(await resolveMentionsIn(db, projectId, "@Jules hi")).toBe("@Jules hi");
  });

  it("never resolves a user who is not a member", async () => {
    const { projectId } = await createProjectFixture(db);
    await insertUser(db, { name: "Stranger" });
    expect(await resolveMentionsIn(db, projectId, "@Stranger hi")).toBe("@Stranger hi");
  });
});
