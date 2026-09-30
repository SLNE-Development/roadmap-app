import { describe, expect, it } from "vitest";
import { user, userPref } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { eq } from "drizzle-orm";
import { InvalidError } from "./errors";
import { deletePref, getPref, getPrefs, setPref } from "./prefs";

describe("prefs", () => {
  it("stores a value and reads it back", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "overview.panels", ["attention", "updates"]);
    expect(await getPref(db, a.userId, "overview.panels")).toEqual([
      "attention",
      "updates",
    ]);
  });

  it("overwrites a key and bumps updated_at", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "theme", "dark");
    await db.update(userPref).set({ updatedAt: new Date(1000) });
    await setPref(db, a, "theme", "light");
    expect(await getPref(db, a.userId, "theme")).toBe("light");
    const [row] = await db.select().from(userPref);
    expect(row.updatedAt.getTime()).toBeGreaterThan(1000);
  });

  it("keeps prefs per user", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    const b = await insertUser(db);
    await setPref(db, a, "theme", "dark");
    expect(await getPref(db, b.userId, "theme")).toBeNull();
  });

  it("lists the keys under a prefix and nothing else", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    const b = await insertUser(db);
    await setPref(db, a, "board.collapsed.b1", true);
    await setPref(db, a, "board.collapsed.b2", false);
    await setPref(db, a, "board.other", 1);
    await setPref(db, b, "board.collapsed.b3", true);
    expect(await getPrefs(db, a.userId, "board.collapsed.")).toEqual({
      "board.collapsed.b1": true,
      "board.collapsed.b2": false,
    });
  });

  it("treats LIKE wildcards in a prefix literally", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "abc", 1);
    expect(await getPrefs(db, a.userId, "%")).toEqual({});
  });

  it("rejects a malformed key", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await expect(setPref(db, a, "Bad Key", 1)).rejects.toBeInstanceOf(
      InvalidError,
    );
  });

  it("rejects a value over 8 KB", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    const err = await setPref(db, a, "big", "x".repeat(9000)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidError);
    expect((err as Error).message).toBe("A preference must be at most 8 KB.");
  });

  it("deletes a key and tolerates a missing one", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "theme", "dark");
    await deletePref(db, a, "theme");
    expect(await getPref(db, a.userId, "theme")).toBeNull();
    await expect(deletePref(db, a, "theme")).resolves.toBeUndefined();
  });

  it("cascades when the user is deleted", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "theme", "dark");
    await db.delete(user).where(eq(user.id, a.userId));
    expect(await db.select().from(userPref)).toEqual([]);
  });
});
