import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listMembers, removeMember, setMember } from "./members";
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
});
