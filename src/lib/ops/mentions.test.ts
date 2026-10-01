import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedAccount, notification, question, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { notifyMentions, resolveMentionsIn } from "./mentions";
import { addQuestion } from "./questions";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("resolveMentionsIn", () => {
  it("resolves current members only", async () => {
    const { owner, slug, projectId } = await createProjectFixture(db);
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    const out = await resolveMentionsIn(db, projectId, "@Jules hi", 5000);
    expect(out).toContain(`user:${jules.userId}`);

    const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, jules.userId));
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, row.discordId!));
    expect(await resolveMentionsIn(db, projectId, "@Jules hi", 5000)).toBe("@Jules hi");
  });

  it("never resolves a user who is not a member", async () => {
    const { projectId } = await createProjectFixture(db);
    await insertUser(db, { name: "Stranger" });
    expect(await resolveMentionsIn(db, projectId, "@Stranger hi", 5000)).toBe("@Stranger hi");
  });

  it("keeps the text as written when resolving would make it longer than the field allows", async () => {
    const { owner, slug } = await createProjectFixture(db);
    await addMemberFixture(db, owner, slug, "editor", "Jules");
    const text = `@Jules ${"x".repeat(4990)}`;
    const { id } = await addQuestion(db, owner, slug, { title: "Long", text });
    const [row] = await db.select({ text: question.text }).from(question).where(eq(question.id, id));
    expect(row.text).toBe(text);
    expect(await db.select().from(notification)).toEqual([]);
  });
});

describe("notifyMentions", () => {
  it("notifies newly mentioned members once, never the author", async () => {
    const { owner, slug, projectId } = await createProjectFixture(db);
    const e = await addMemberFixture(db, owner, slug, "editor", "E");
    const after = `[@E](user:${e.userId}) [@Owner](user:${owner.userId})`;
    const notice = { projectId, title: "Owner mentioned you", href: "/p/demo/systems/auth", source: "system:s1:notes" };
    await notifyMentions(db, owner, { ...notice, before: null, after });
    const rows = await db.select().from(notification);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: e.userId, kind: "mention", entity: "system", entityId: "s1", body: "@E @Owner", sourceKey: `system:s1:notes:mention:${e.userId}` });

    await notifyMentions(db, owner, { ...notice, before: after, after });
    expect(await db.select().from(notification)).toHaveLength(1);
  });
});
