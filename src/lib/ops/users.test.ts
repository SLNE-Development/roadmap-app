import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apikey, allowedAccount, session, user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import {
  addAllowedAccount,
  checkSignIn,
  listAllowedAccounts,
  listUsers,
  loadActor,
  removeAllowedAccount,
  setAdmin,
} from "./users";

describe("checkSignIn", () => {
  it("lets the very first account in", async () => {
    const db = await createTestDb();
    expect(await checkSignIn(db, "123456789012345678")).toBe("first-user");
  });

  it("afterwards admits only provisioned Discord ids", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" });
    expect(await checkSignIn(db, "223456789012345678")).toBe("allowed");
    expect(await checkSignIn(db, "999999999999999999")).toBe("rejected");
    expect(await checkSignIn(db, "")).toBe("rejected");
  });
});

describe("allowlist management", () => {
  it("is admin-only", async () => {
    const db = await createTestDb();
    const member = await insertUser(db);
    await expect(addAllowedAccount(db, member, { discordId: "223456789012345678", displayName: "Sam" })).rejects.toThrow(
      "Only admins can manage accounts.",
    );
    await expect(listAllowedAccounts(db, member)).rejects.toThrow("Only admins");
  });

  it("rejects malformed and duplicate Discord ids", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await expect(addAllowedAccount(db, admin, { discordId: "abc", displayName: "Sam" })).rejects.toThrow(/15 to 21 digits/);
    await addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" });
    await expect(addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" })).rejects.toThrow(
      "Discord id 223456789012345678 is already added.",
    );
  });

  it("lists accounts with the user they became", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { name: "Ada", isAdmin: true, discordId: "123456789012345678" });
    await addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" });
    const rows = await listAllowedAccounts(db, admin);
    expect(rows.map((r) => [r.displayName, r.userName, r.isAdmin])).toEqual([
      ["Ada", "Ada", true],
      ["Sam", null, false],
    ]);
  });
});

describe("removing an account", () => {
  it("ends the user's sessions and revokes their keys immediately", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const sam = await insertUser(db, { name: "Sam", discordId: "223456789012345678" });
    await db.insert(session).values({ id: "s1", token: "t1", userId: sam.userId, expiresAt: new Date(Date.now() + 1e7) });
    await db.insert(apikey).values({ id: "k1", key: "hash", referenceId: sam.userId });
    expect(await loadActor(db, sam.userId)).toMatchObject({ name: "Sam" });

    await removeAllowedAccount(db, admin, "223456789012345678");

    expect(await loadActor(db, sam.userId)).toBeNull();
    expect(await db.select().from(session)).toEqual([]);
    expect(await db.select().from(apikey)).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(2);
  });

  it("refuses to remove the last admin", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true, discordId: "123456789012345678" });
    await expect(removeAllowedAccount(db, admin, "123456789012345678")).rejects.toThrow("You cannot remove the last admin.");
  });

  it("reports an unknown Discord id", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await expect(removeAllowedAccount(db, admin, "999999999999999999")).rejects.toThrow("Unknown Discord id 999999999999999999.");
  });
});

describe("setAdmin", () => {
  it("grants and revokes admin but keeps at least one admin", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const sam = await insertUser(db);
    await setAdmin(db, admin, sam.userId, true);
    expect((await loadActor(db, sam.userId))?.isAdmin).toBe(true);
    await setAdmin(db, admin, sam.userId, false);
    await expect(setAdmin(db, admin, admin.userId, false)).rejects.toThrow("The last admin cannot drop the admin flag.");
  });

  it("rejects setAdmin on a removed (unprovisioned) user with 404", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const sam = await insertUser(db, { name: "Sam", discordId: "223456789012345678" });
    await removeAllowedAccount(db, admin, "223456789012345678");
    await expect(setAdmin(db, admin, sam.userId, false)).rejects.toThrow("Unknown user");
  });

  it("does not count unprovisioned admins toward last-admin check", async () => {
    const db = await createTestDb();
    const admin1 = await insertUser(db, { isAdmin: true, discordId: "123456789012345678" });
    await insertUser(db, { name: "Admin2", isAdmin: true, discordId: "223456789012345678" });
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, "223456789012345678"));
    await expect(setAdmin(db, admin1, admin1.userId, false)).rejects.toThrow("The last admin cannot drop the admin flag.");
  });

  it("rejects setAdmin on unknown user with 404", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await expect(setAdmin(db, admin, "unknown-id", false)).rejects.toThrow("Unknown user");
  });
});

describe("removing a non-last admin", () => {
  it("works and demotes the admin", async () => {
    const db = await createTestDb();
    const admin1 = await insertUser(db, { isAdmin: true, discordId: "123456789012345678" });
    const admin2 = await insertUser(db, { isAdmin: true, name: "Admin2", discordId: "223456789012345678" });
    await removeAllowedAccount(db, admin1, "223456789012345678");
    const demoted = await loadActor(db, admin2.userId);
    expect(demoted).toBeNull();
  });
});

describe("listUsers", () => {
  it("lists only provisioned users, by name", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { name: "Zed", isAdmin: true });
    await insertUser(db, { name: "Amy", discordId: "223456789012345678" });
    await removeAllowedAccount(db, admin, "223456789012345678");
    await insertUser(db, { name: "Bob" });
    expect((await listUsers(db)).map((u) => u.name)).toEqual(["Bob", "Zed"]);
  });
});
