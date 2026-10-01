import { eq } from "drizzle-orm";
import { z } from "zod";
import { eventSettings } from "@/db/schema";
import type { Db } from "@/db/types";
import { DEFAULT_EVENT_TIME_ZONE } from "@/lib/event-prep-template";
import { MAX_POST_TEXT } from "@/lib/event-messages";
import { buildPrompts, describeAnswer, MODERATION_PREFIX, PROMPT_KINDS, type PromptKind } from "@/lib/event-prompts";
import type { Actor } from "./actor";
import { InvalidError } from "./errors";
import { requestAccess } from "./request-access";
import { listFallbacks } from "./request-fallback";
import { savePostDraft } from "./request-posts";
import { listRounds } from "./request-questions";
import { getBrief, logRequest } from "./requests";

/** Input of {@link savePasteBack}: the text the planner pasted back. */
export const savePasteBackInput = z.object({ kind: z.enum(PROMPT_KINDS), text: z.string().max(MAX_POST_TEXT) });

/**
 * The only settings columns a prompt reads: styles, examples, time zone and rulebook link. Never a secret (`*Enc`)
 * column; a test pins this list.
 */
const PROMPT_SETTINGS_COLUMNS = {
  timeZone: eventSettings.timeZone,
  rulebookUrl: eventSettings.rulebookUrl,
  announcementStyle: eventSettings.announcementStyle,
  announcementExample: eventSettings.announcementExample,
  reminderExample: eventSettings.reminderExample,
  teamStyle: eventSettings.teamStyle,
  teamExample: eventSettings.teamExample,
};

/**
 * Builds the three copy prompts of a request from its details, brief, answers, fallback plan and the style settings.
 * Nothing is sent anywhere and no secret is read.
 *
 * @throws NotFoundError when the actor may not see the request, ForbiddenError without edit access
 */
export async function getPrompts(db: Db, actor: Actor, requestId: string): Promise<Record<PromptKind, string>> {
  const { request } = await requestAccess(db, actor, requestId, "edit");
  const [row] = await db.select(PROMPT_SETTINGS_COLUMNS).from(eventSettings).where(eq(eventSettings.id, "default")).limit(1);
  const settings = row ?? { timeZone: DEFAULT_EVENT_TIME_ZONE, rulebookUrl: null, announcementStyle: "", announcementExample: "", reminderExample: "", teamStyle: "", teamExample: "" };
  const brief = await getBrief(db, actor, requestId);
  const rounds = await listRounds(db, actor, requestId);
  const fallbacks = await listFallbacks(db, actor, requestId);
  const answers = rounds
    .flatMap((r) => r.questions)
    .map((q) => ({ question: q.text, answer: describeAnswer(q) }))
    .filter((a) => a.answer !== "");
  return buildPrompts({
    request,
    settings,
    brief: brief.body,
    answers,
    fallback: fallbacks.map((f) => ({ title: f.title, whatWeDo: f.whatWeDo, whoDecides: f.whoDecides })),
    moderation: answers.filter((a) => a.question.startsWith(MODERATION_PREFIX)),
  });
}

/**
 * Stores the text pasted back from a chat assistant as the draft of the matching post, for review in the composer.
 * Sends nothing and changes no status.
 *
 * @throws InvalidError for an empty paste or a text over 40,000 characters, ConflictError once the post is sending, partial or posted
 * (use Edit), NotFoundError / ForbiddenError as {@link savePostDraft}
 */
export async function savePasteBack(db: Db, actor: Actor, requestId: string, kind: PromptKind, text: string): Promise<void> {
  const parsed = savePasteBackInput.safeParse({ kind, text });
  if (!parsed.success) throw new InvalidError(parsed.error.issues.map((i) => i.message).join(" "));
  if (!parsed.data.text.trim()) throw new InvalidError("Paste the text first.");
  await savePostDraft(db, actor, requestId, parsed.data.kind, { text: parsed.data.text });
  await logRequest(db, actor, { requestId, field: "post", newValue: `${parsed.data.kind} draft pasted` });
}
