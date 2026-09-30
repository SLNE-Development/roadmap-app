import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { isMember, listMembers, removeMember, setMember } from "./members";
import { removeAllowedAccount } from "./users";

describe("members", () => {
  it("adds, re-roles and lists members by name", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await setMember(db, owner, slug, { userId: editor.userId, role: "viewer" });
    expect((await listMembers(db, owner, slug)).map((m) => [m.name, m.role])).toEqual([
      ["Owner", "owner"],
      ["editor member", "viewer"],
    ]);
  });

  it("only lets owners manage members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const other = await insertUser(db);
    await expect(setMember(db, editor, slug, { userId: other.userId, role: "viewer" })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses users that are not provisioned", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const admin = await insertUser(db, { isAdmin: true });
    const gone = await insertUser(db, { discordId: "323456789012345678" });
    await removeAllowedAccount(db, admin, "323456789012345678");
    await expect(setMember(db, owner, slug, { userId: gone.userId, role: "viewer" })).rejects.toMatchObject({ status: 404 });
  });

  it("does not count memberships of removed accounts", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const admin = await insertUser(db, { isAdmin: true });
    const member = await insertUser(db, { discordId: "423456789012345678" });
    await setMember(db, owner, slug, { userId: member.userId, role: "editor" });
    expect(await isMember(db, projectId, member.userId)).toBe(true);
    await removeAllowedAccount(db, admin, "423456789012345678");
    expect(await isMember(db, projectId, member.userId)).toBe(false);
    expect(await isMember(db, projectId, owner.userId)).toBe(true);
  });

  it("always keeps one owner", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(setMember(db, owner, slug, { userId: owner.userId, role: "editor" })).rejects.toMatchObject({
      status: 409,
      message: "A project needs at least one owner.",
    });
    await expect(removeMember(db, owner, slug, owner.userId)).rejects.toMatchObject({ status: 409 });
    const second = await addMemberFixture(db, owner, slug, "owner");
    await removeMember(db, second, slug, owner.userId);
    expect((await listMembers(db, second, slug)).map((m) => m.role)).toEqual(["owner"]);
  });

  it("never ends up without an owner when two owners demote each other concurrently", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const second = await addMemberFixture(db, owner, slug, "owner");
    const results = await Promise.allSettled([
      setMember(db, owner, slug, { userId: second.userId, role: "editor" }),
      setMember(db, second, slug, { userId: owner.userId, role: "editor" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await listMembers(db, owner, slug).catch(() => listMembers(db, second, slug))).filter((m) => m.role === "owner")).toHaveLength(1);
  });
});
