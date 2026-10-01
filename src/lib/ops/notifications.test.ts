import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedAccount, notification, project, user } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listNotifications, markAllRead, markRead, notify, unreadCount, type NotifyInput } from "./notifications";

let db: Db;
let owner: Actor;
let editor: Actor;
let stranger: Actor;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, projectId } = await createProjectFixture(db));
  editor = await addMemberFixture(db, owner, "demo", "editor", "Edi");
  stranger = await insertUser(db, { name: "Stranger" });
});

/** A notice for `userId` with source key `sourceKey`. */
const input = (userId: string, sourceKey: string, extra: Partial<NotifyInput> = {}): NotifyInput => ({
  userId,
  projectId,
  kind: "mention",
  entity: "question",
  entityId: "q1",
  title: "Owner mentioned you",
  href: "/p/demo/questions#q-q1",
  actorName: "Owner",
  sourceKey,
  ...extra,
});

describe("notify", () => {
  it("creates one inbox row for a member", async () => {
    expect(await notify(db, input(editor.userId, "cl:1"))).toBe(true);
    const items = await listNotifications(db, editor, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "mention", projectSlug: "demo", projectName: "DEMO", actorName: "Owner", readAt: null });
    expect(await unreadCount(db, editor)).toBe(1);
  });

  it("creates nothing twice for the same source key", async () => {
    await notify(db, input(editor.userId, "cl:1"));
    expect(await notify(db, input(editor.userId, "cl:1"))).toBe(false);
    expect(await db.select().from(notification)).toHaveLength(1);
  });

  it("never notifies a non-member", async () => {
    expect(await notify(db, input(stranger.userId, "cl:1"))).toBe(false);
    expect(await db.select().from(notification)).toHaveLength(0);
  });

  it("stops notifying and listing for a removed account", async () => {
    await notify(db, input(editor.userId, "cl:1"));
    const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, editor.userId));
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, row.discordId!));
    expect(await notify(db, input(editor.userId, "cl:2"))).toBe(false);
    expect(await listNotifications(db, editor, {})).toEqual([]);
    expect(await unreadCount(db, editor)).toBe(0);
  });

  it("never notifies in an archived project", async () => {
    await db.update(project).set({ archivedAt: new Date() }).where(eq(project.id, projectId));
    expect(await notify(db, input(owner.userId, "cl:1"))).toBe(false);
  });

  it("truncates the title and turns mention tokens into plain text", async () => {
    await notify(db, input(editor.userId, "cl:1", { title: "t".repeat(120), body: `hi [@Rik](user:cccccccc-cccc-4ccc-8ccc-cccccccccccc)` }));
    const [row] = await db.select().from(notification);
    expect(row.title).toHaveLength(80);
    expect(row.title.endsWith("…")).toBe(true);
    expect(row.body).toBe("hi @Rik");
  });
});

describe("inbox", () => {
  it("marks only the actor's own rows read", async () => {
    await notify(db, input(owner.userId, "cl:1"));
    await notify(db, input(editor.userId, "cl:1"));
    await notify(db, input(editor.userId, "cl:2"));
    const [ownerRow] = await db.select().from(notification).where(eq(notification.userId, owner.userId));
    await markRead(db, editor, [ownerRow.id]);
    expect(await unreadCount(db, owner)).toBe(1);

    const [first] = await listNotifications(db, editor, {});
    await markRead(db, editor, [first.id]);
    const [again] = (await listNotifications(db, editor, {})).filter((n) => n.id === first.id);
    expect(again.readAt).toBeInstanceOf(Date);
    expect(await unreadCount(db, editor)).toBe(1);

    await markAllRead(db, editor);
    expect(await unreadCount(db, editor)).toBe(0);
    expect(await unreadCount(db, owner)).toBe(1);
  });

  it("caps the unread count at 100, so callers can show 99+", async () => {
    await db.insert(notification).values(
      Array.from({ length: 150 }, (_, i) => ({
        id: `n-${String(i).padStart(3, "0")}`,
        userId: editor.userId,
        projectId,
        kind: "mention" as const,
        entity: "question",
        entityId: "q1",
        title: "t",
        href: "/p/demo",
        sourceKey: `cl:${i}`,
      })),
    );
    expect(await unreadCount(db, editor)).toBe(100);
  });

  it("pages newest first with a cursor", async () => {
    for (let i = 0; i < 35; i++) await notify(db, input(editor.userId, `cl:${i}`));
    const page1 = await listNotifications(db, editor, {});
    expect(page1).toHaveLength(30);
    const page2 = await listNotifications(db, editor, { before: page1.at(-1)!.id });
    expect(page2).toHaveLength(5);
    const ids = new Set([...page1, ...page2].map((n) => n.id));
    expect(ids.size).toBe(35);
  });
});
