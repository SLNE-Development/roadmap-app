import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPost, eventRequest, requestLog } from "@/db/schema";
import { memoryQueue } from "@/lib/queue";
import { insertUser } from "@/test/fixtures";
import { draftPost, postWorld, stubEncryptionKey } from "@/test/post-fixtures";
import { updateEventSettings } from "./event-settings";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { getPrompts, savePasteBack } from "./request-prompts";
import { startPost } from "./request-posts";
import { answerQuestions, askRound, listRounds } from "./request-questions";

beforeEach(stubEncryptionKey);
afterEach(() => vi.unstubAllEnvs());

describe("getPrompts", () => {
  it("builds the prompts for the requester and the manager from the stored data", async () => {
    const w = await postWorld();
    await updateEventSettings(w.db, w.manager, { announcementStyle: "STYLE-ANN", rulebookUrl: "https://example.com/regeln" });
    const dev = await insertUser(w.db, { name: "Dev", isEventDeveloper: true });
    await askRound(w.db, dev, w.request.id, { questions: [{ type: "yesno", text: "Gibt es Preise?" }, { type: "number", text: "Moderation: Wie viele Mods?", unit: "Mods" }] });
    const [round] = await listRounds(w.db, w.requester, w.request.id);
    await answerQuestions(w.db, w.requester, w.request.id, { answers: [{ questionId: round.questions[0].id, value: true }, { questionId: round.questions[1].id, value: 3 }] });
    const mine = await getPrompts(w.db, w.requester, w.request.id);
    expect(mine.announcement).toContain("STYLE-ANN");
    expect(mine.announcement).toContain("Gibt es Preise?: Ja");
    expect(mine.team).toContain("Moderation: Wie viele Mods?: 3 Mods");
    expect(mine.announcement).toContain("Hafenwelt");
    expect((await getPrompts(w.db, w.manager, w.request.id)).announcement).toBe(mine.announcement);
  });

  it("hides the request from a stranger", async () => {
    const w = await postWorld();
    await expect(getPrompts(w.db, w.stranger, w.request.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("selects no secret column of the settings", async () => {
    const w = await postWorld();
    const select = vi.spyOn(w.db, "select");
    await getPrompts(w.db, w.requester, w.request.id);
    const keys = select.mock.calls.flatMap(([cols]) => Object.keys((cols ?? {}) as object));
    expect(keys).toContain("announcementStyle");
    expect(keys.filter((k) => /enc$|hint$|token|webhook/i.test(k))).toEqual([]);
  });
});

describe("savePasteBack", () => {
  it("stores the text as the announcement draft and sends nothing", async () => {
    const w = await postWorld();
    const queue = memoryQueue();
    const [before] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    await savePasteBack(w.db, w.requester, w.request.id, "announcement", "# Piratenfest\n\nKommt vorbei.");
    const [post] = await w.db.select().from(eventPost).where(eq(eventPost.requestId, w.request.id));
    expect(post).toMatchObject({ kind: "announcement", text: "# Piratenfest\n\nKommt vorbei.", status: "draft" });
    expect(post.parts).toEqual([]);
    expect(queue.jobs).toHaveLength(0);
    const [after] = await w.db.select().from(eventRequest).where(eq(eventRequest.id, w.request.id));
    expect(after.status).toBe(before.status);
    const log = await w.db.select().from(requestLog).where(eq(requestLog.requestId, w.request.id));
    expect(log.some((l) => l.field === "post" && l.newValue === "announcement draft pasted")).toBe(true);
  });

  it("refuses an empty paste", async () => {
    const w = await postWorld();
    await expect(savePasteBack(w.db, w.requester, w.request.id, "team", "   ")).rejects.toBeInstanceOf(InvalidError);
  });

  it("refuses a text over 40,000 characters", async () => {
    const w = await postWorld();
    await expect(savePasteBack(w.db, w.requester, w.request.id, "team", "a".repeat(40_001))).rejects.toBeInstanceOf(InvalidError);
  });

  it("refuses once the post is posted", async () => {
    const w = await postWorld();
    const post = await draftPost(w.db, w.manager, w.request.id, "announcement", { text: "Hallo" });
    await startPost(w.db, w.manager, w.request.id, "announcement", memoryQueue());
    await w.db.update(eventPost).set({ status: "posted" }).where(eq(eventPost.id, post.id));
    await expect(savePasteBack(w.db, w.manager, w.request.id, "announcement", "Neu")).rejects.toBeInstanceOf(ConflictError);
  });
});
