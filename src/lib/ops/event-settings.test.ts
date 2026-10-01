import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventSettings, eventTodo, eventUpload } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { loadEventSecrets } from "@/lib/event-secrets";
import { DEFAULT_EVENT_TIME_ZONE, dueFor, PREP_TEMPLATE } from "@/lib/event-prep-template";
import { createTestDb } from "@/test/db";
import { insertUser, requestFixture } from "@/test/fixtures";
import { ForbiddenError, InvalidError } from "./errors";
import { eventTimeZone, getEventSettings, previewTemplate, setEventSecrets, updateEventSettings } from "./event-settings";
import { ensurePrepTodos } from "./request-setup";
import { UPLOAD_REFERENCES } from "./uploads";

const HOOK = "https://discord.com/api/webhooks/123456789/tok-en_abcd";
const TEAM_HOOK = "https://discord.com/api/webhooks/987654321/other_wxyz";
const TOKEN = "MTExMjIyMzMzNDQ0NTU1NjY2.Gabcde.abcdefghijklmnopqrstuvwxyz0123456789XYZ";

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A database with an admin, an event manager, an event developer and a user without roles. */
async function world() {
  const db = await createTestDb();
  const admin = await insertUser(db, { name: "Admin", isAdmin: true });
  const manager = await insertUser(db, { name: "Manager", isEventManager: true });
  const developer = await insertUser(db, { name: "Developer", isEventDeveloper: true });
  const stranger = await insertUser(db, { name: "Stranger" });
  return { db, admin, manager, developer, stranger };
}

describe("getEventSettings", () => {
  it("creates the row with defaults on first read", async () => {
    const { db, manager } = await world();
    const s = await getEventSettings(db, manager);
    expect(s).toMatchObject({ postAs: "Event-Team", timeZone: "Europe/Berlin", pingRoleId: null, rulebookUrl: null, announcementStyle: "" });
    expect(s.disasterTemplate.title).toBe("Wir arbeiten an einer Lösung");
    expect(s.detailsTemplate.lines).toHaveLength(6);
    expect(s.secrets.publicWebhook).toEqual({ set: false, hint: null });
    expect(await db.select().from(eventSettings)).toHaveLength(1);
  });

  it("lets managers, developers and admins read and nobody else", async () => {
    const { db, admin, manager, developer, stranger } = await world();
    for (const actor of [admin, manager, developer]) await expect(getEventSettings(db, actor)).resolves.toBeDefined();
    await expect(getEventSettings(db, stranger)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never carries a secret to a manager, only the masked hint", async () => {
    const { db, admin, manager } = await world();
    await setEventSecrets(db, admin, { publicWebhook: HOOK, botToken: TOKEN });
    const [row] = await db.select().from(eventSettings);
    const view = await getEventSettings(db, manager);
    const text = JSON.stringify(view);
    for (const forbidden of ["discord.com/api/webhooks", "tok-en", TOKEN, "Enc", "v1."]) expect(text).not.toContain(forbidden);
    for (const enc of [row.publicWebhookEnc!, row.botTokenEnc!]) {
      for (let i = 0; i + 12 <= enc.length; i += 6) expect(text).not.toContain(enc.slice(i, i + 12));
    }
    expect(view.secrets.publicWebhook).toEqual({ set: true, hint: "••••abcd" });
    expect(view.secrets.botToken).toEqual({ set: true, hint: `••••${TOKEN.slice(-4)}` });
  });
});

describe("updateEventSettings", () => {
  it("lets a manager change managed fields and records who, logging names only", async () => {
    const { db, manager } = await world();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await updateEventSettings(db, manager, { postAs: "Crew", pingRoleId: "123456789012345678", timeZone: "UTC", rulebookUrl: "https://example.com/rules", teamStyle: "locker" });
    const s = await getEventSettings(db, manager);
    expect(s).toMatchObject({ postAs: "Crew", pingRoleId: "123456789012345678", timeZone: "UTC", rulebookUrl: "https://example.com/rules", teamStyle: "locker" });
    const [row] = await db.select().from(eventSettings);
    expect(row.updatedBy).toBe(manager.userId);
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("postAs");
    expect(logged).not.toContain("Crew");
  });

  it("does nothing for an empty input", async () => {
    const { db, manager } = await world();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await updateEventSettings(db, manager, {});
    expect(info).not.toHaveBeenCalled();
    expect(await db.select().from(eventSettings)).toHaveLength(0);
  });

  it("clears nullable fields", async () => {
    const { db, manager } = await world();
    await updateEventSettings(db, manager, { pingRoleId: "123456789012345678" });
    await updateEventSettings(db, manager, { pingRoleId: null });
    expect((await getEventSettings(db, manager)).pingRoleId).toBeNull();
  });

  it("refuses a secret key, from a manager and from an admin alike", async () => {
    const { db, manager, admin } = await world();
    for (const actor of [manager, admin]) {
      await expect(updateEventSettings(db, actor, { publicWebhook: HOOK })).rejects.toBeInstanceOf(InvalidError);
      await expect(updateEventSettings(db, actor, { publicWebhook: HOOK })).rejects.toThrow(/publicWebhook/);
      await expect(updateEventSettings(db, actor, { botTokenEnc: "x" })).rejects.toThrow(/botTokenEnc/);
    }
  });

  it("refuses developers and strangers", async () => {
    const { db, developer, stranger } = await world();
    await expect(updateEventSettings(db, developer, { postAs: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateEventSettings(db, stranger, { postAs: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates fields", async () => {
    const { db, manager } = await world();
    const bad = (input: unknown) => expect(updateEventSettings(db, manager, input)).rejects.toBeInstanceOf(InvalidError);
    await bad({ timeZone: "Mars/Base" });
    await bad({ pingRoleId: "12ab" });
    await bad({ guildId: "abc" });
    await bad({ rulebookUrl: "http://example.com" });
    await bad({ postAs: "x".repeat(81) });
    await bad({ teamStyle: "x".repeat(20_001) });
    await bad({ disasterTemplate: { title: "t", text: "x", color: "red", imageUploadId: null } });
    await bad({ detailsTemplate: { lines: Array.from({ length: 11 }, () => "x"), color: "#112233", footer: "" } });
  });

  it("accepts a template image only from a template upload and blocks its deletion", async () => {
    const { db, manager } = await world();
    const requester = await insertUser(db, { name: "Requester" });
    const request = await requestFixture(db, requester);
    const file = { uploaderId: manager.userId, originalName: "a.png", mime: "image/png", bytes: 1 };
    await db.insert(eventUpload).values([
      { id: "tpl", requestId: null, purpose: "template", storageKey: "tpl.png", ...file },
      { id: "req", requestId: request.id, purpose: "banner", storageKey: "req.png", ...file },
    ]);
    const template = (imageUploadId: string) => ({ title: "t", text: "x", color: "#112233", imageUploadId });
    await expect(updateEventSettings(db, manager, { disasterTemplate: template("req") })).rejects.toBeInstanceOf(InvalidError);
    await expect(updateEventSettings(db, manager, { disasterTemplate: template("nope") })).rejects.toBeInstanceOf(InvalidError);
    await updateEventSettings(db, manager, { disasterTemplate: template("tpl") });
    const used = (id: string) => db.transaction(async (tx) => (await Promise.all(UPLOAD_REFERENCES.map((check) => check(tx, id)))).includes(true));
    expect(await used("tpl")).toBe(true);
    expect(await used("req")).toBe(false);
  });
});

describe("setEventSecrets", () => {
  it("is for admins only, even for a manager with other flags", async () => {
    const { db, manager } = await world();
    const both = await insertUser(db, { isEventManager: true, isEventDeveloper: true });
    for (const actor of [manager, both]) {
      await expect(setEventSecrets(db, actor, { publicWebhook: HOOK })).rejects.toThrow("Only admins can change event secrets.");
      await expect(setEventSecrets(db, actor, { publicWebhook: HOOK })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("stores an encrypted value with the last four characters as hint", async () => {
    const { db, admin, manager } = await world();
    await setEventSecrets(db, admin, { publicWebhook: HOOK, teamWebhook: TEAM_HOOK, botToken: TOKEN });
    const [row] = await db.select().from(eventSettings);
    expect(row.publicWebhookEnc).not.toBe(HOOK);
    expect(row.publicWebhookEnc).not.toContain("discord");
    expect(decryptSecret(row.publicWebhookEnc!)).toBe(HOOK);
    expect(row.publicWebhookHint).toBe("abcd");
    expect(row.teamWebhookHint).toBe("wxyz");
    expect(row.botTokenHint).toBe(TOKEN.slice(-4));
    expect((await getEventSettings(db, manager)).secrets.teamWebhook).toEqual({ set: true, hint: "••••wxyz" });
    expect(await loadEventSecrets(db)).toEqual({ publicWebhook: HOOK, teamWebhook: TEAM_HOOK, staffWebhook: null, botToken: TOKEN });
  });

  it("leaves omitted secrets and clears with null", async () => {
    const { db, admin, manager } = await world();
    await setEventSecrets(db, admin, { publicWebhook: HOOK, staffWebhook: HOOK });
    await setEventSecrets(db, admin, { publicWebhook: null });
    const s = await getEventSettings(db, manager);
    expect(s.secrets.publicWebhook).toEqual({ set: false, hint: null });
    expect(s.secrets.staffWebhook.set).toBe(true);
    expect((await loadEventSecrets(db)).publicWebhook).toBeNull();
  });

  it("rejects bad values without echoing them", async () => {
    const { db, admin } = await world();
    const url = "https://example.com/hook";
    const error = await setEventSecrets(db, admin, { publicWebhook: url }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidError);
    expect((error as Error).message).toBe("Use a Discord webhook URL from Channel settings → Integrations → Webhooks.");
    expect((error as Error).message).not.toContain(url);
    const spaced = `${"a".repeat(30)} ${"b".repeat(30)}`;
    const spacedError = await setEventSecrets(db, admin, { botToken: spaced }).catch((e: unknown) => e);
    expect(spacedError).toBeInstanceOf(InvalidError);
    expect((spacedError as Error).message).not.toContain(spaced);
    await expect(setEventSecrets(db, admin, { botToken: "short" })).rejects.toBeInstanceOf(InvalidError);
    await expect(setEventSecrets(db, admin, { postAs: "x" })).rejects.toBeInstanceOf(InvalidError);
  });

  it("writes nothing recognisable to the console", async () => {
    const { db, admin } = await world();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await setEventSecrets(db, admin, { publicWebhook: HOOK, botToken: TOKEN });
    await setEventSecrets(db, admin, { publicWebhook: "https://example.com/x" }).catch(() => {});
    const out = spies.flatMap((s) => s.mock.calls.flat()).join(" ");
    for (const secret of [HOOK, "tok-en", TOKEN, "abcdefghijklmn", "example.com/x"]) expect(out).not.toContain(secret);
  });
});

describe("previewTemplate", () => {
  it("renders a template with a sample request, the note only where allowed", async () => {
    const { db, developer } = await world();
    const disaster = await previewTemplate(db, developer, { kind: "disaster", template: { title: "{event}", text: "{event} {note}", color: "#c23636", imageUploadId: null } });
    expect(disaster).toMatchObject({ kind: "embed", title: "Piratenfest", text: "Piratenfest {note}" });
    const resolved = await previewTemplate(db, developer, { kind: "resolved", template: { title: "x", text: "{event}: {note}", color: "#1a7048", imageUploadId: null } });
    expect(resolved).toMatchObject({ kind: "embed", text: expect.stringMatching(/^Piratenfest: .+/) });
    const details = await previewTemplate(db, developer, { kind: "details", template: { lines: ["Datum: {date}", "Ort: {where}"], color: "#112233", footer: "Hi" } });
    expect(details).toMatchObject({ kind: "details", lines: ["Datum: Samstag, 17. Oktober 2026", "Ort: Hafenwelt"], footer: "Hi" });
  });

  it("is closed to strangers and to a template of the wrong shape", async () => {
    const { db, stranger, developer } = await world();
    const embed = { title: "", text: "", color: "#112233", imageUploadId: null };
    await expect(previewTemplate(db, stranger, { kind: "disaster", template: embed })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(previewTemplate(db, developer, { kind: "details", template: embed })).rejects.toBeInstanceOf(InvalidError);
  });
});

describe("time zone of the prep to-dos", () => {
  it("falls back to the default and follows the settings", async () => {
    const { db, manager } = await world();
    expect(await eventTimeZone(db)).toBe(DEFAULT_EVENT_TIME_ZONE);
    expect(await db.select().from(eventSettings)).toHaveLength(0);
    await updateEventSettings(db, manager, { timeZone: "America/New_York" });
    expect(await eventTimeZone(db)).toBe("America/New_York");
    const requester = await insertUser(db, { name: "Requester" });
    const request = await requestFixture(db, requester, { status: "accepted", startsAt: new Date("2026-10-17T18:00:00Z") });
    await ensurePrepTodos(db, request, manager.userId);
    const todos = await db.select().from(eventTodo).where(eq(eventTodo.requestId, request.id));
    const step = PREP_TEMPLATE[0];
    expect(todos.find((t) => t.templateKey === step.key)!.dueAt.getTime()).toBe(dueFor(request.startsAt!, step.offsetDays, "America/New_York").getTime());
  });
});
