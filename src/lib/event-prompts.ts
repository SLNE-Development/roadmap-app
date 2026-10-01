import { placeholderValues, VISIBLE_PLACEHOLDERS } from "@/lib/event-placeholders";
import { DEFAULT_STYLE_GUIDES } from "@/lib/event-templates";
import type { QuestionType } from "@/lib/event-questions";

/** The texts the planner copies: the announcement, the reminder, the team message and the short description. */
export const PROMPT_KINDS = ["announcement", "reminder", "team", "summary"] as const;

/** One of {@link PROMPT_KINDS}. */
export type PromptKind = (typeof PROMPT_KINDS)[number];

/** The prefix that marks a question as a moderation question. */
export const MODERATION_PREFIX = "Moderation:";

/** Everything a prompt is built from; already read and checked by the op. */
export interface PromptInput {
  request: { title: string; startsAt: Date | null; durationMinutes: number | null; where: string; eventDocsUrl: string | null };
  settings: {
    timeZone: string;
    rulebookUrl: string | null;
    announcementStyle: string;
    announcementExample: string;
    reminderExample: string;
    teamStyle: string;
    teamExample: string;
  };
  brief: string;
  answers: { question: string; answer: string }[];
  fallback: { title: string; whatWeDo: string; whoDecides: string }[];
  moderation: { question: string; answer: string }[];
}

/** A question and its stored answer, as {@link describeAnswer} needs them. */
export interface AnswerSource {
  type: QuestionType;
  unit?: string;
  max?: number;
  answer: unknown;
  notSure: boolean;
}

/** What a "not sure" answer reads as. */
export const NOT_SURE_TEXT = "Offen, das Team entscheidet";

const other = (text: unknown) => `Sonstiges: ${String(text)}`;

/**
 * Renders a typed answer as readable German text: lists joined with commas, yes/no as `Ja`/`Nein`, a scale as `3 von 5`,
 * a number with its unit, a date in full German form. Returns an empty string when there is no answer.
 */
export function describeAnswer(q: AnswerSource): string {
  if (q.notSure) return NOT_SURE_TEXT;
  const a = q.answer;
  if (a === null || a === undefined) return "";
  switch (q.type) {
    case "yesno":
      return a === true ? "Ja" : "Nein";
    case "scale":
      return `${String(a)} von ${q.max ?? 5}`;
    case "number": {
      const n = typeof a === "number" ? new Intl.NumberFormat("de-DE").format(a) : String(a);
      return q.unit ? `${n} ${q.unit}` : n;
    }
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a));
      if (!m) return String(a);
      return new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeZone: "UTC" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
    }
    case "time":
      return `${String(a)} Uhr`;
    case "choice": {
      const v = a as { option?: string; other?: string };
      return v.option ?? (v.other ? other(v.other) : "");
    }
    case "multi": {
      const v = a as { options?: string[]; other?: string };
      return [...(v.options ?? []), ...(v.other ? [other(v.other)] : [])].join(", ");
    }
    case "text":
      return String(a);
  }
}

/** `Label: value` for a non-empty value, else nothing. */
const line = (label: string, value: string): string[] => (value.trim() ? [`${label}: ${value.trim()}`] : []);

/** A block of lines under a heading; dropped when there is no line. */
const block = (heading: string, lines: string[]): string => (lines.length > 0 ? `${heading}\n${lines.join("\n")}` : "");

const join = (parts: string[]): string => parts.filter((p) => p.trim() !== "").join("\n\n");

/** What each placeholder stands for, as the prompts explain it to the assistant. */
const PLACEHOLDER_MEANINGS: Record<string, string> = {
  event: "Name des Events",
  start: "Beginn mit Datum und Uhrzeit",
  start_date: "Datum des Beginns",
  start_time: "Uhrzeit des Beginns",
  end_date: "Datum des Endes",
  end_time: "Uhrzeit des Endes",
  countdown: 'z. B. "in 3 Tagen" bis zum Beginn',
  duration: "Dauer",
  where: "Ort",
  docs: "Link zu den Infos",
  rules: "Link zum Regelwerk",
};

/** The fixed German block that tells the assistant to write placeholders instead of dates, places and links. */
export const PLACEHOLDER_GUIDE = block(
  "Platzhalter",
  [
    ...VISIBLE_PLACEHOLDERS.map((p) => `{${p}} ${PLACEHOLDER_MEANINGS[p]}`),
    "Schreibe Datum, Uhrzeit, Dauer, Ort und Links nie aus, sondern nur als Platzhalter. Die App ersetzt sie beim Senden; Datum und Uhrzeit erscheinen dann in der Zeitzone jedes Lesers.",
  ],
);

/** The essentials of the event: name, date, time, duration and place; empty facts are left out. */
function facts(input: PromptInput, withDuration: boolean): string[] {
  const v = placeholderValues(input.request, input.settings).text;
  return [...line("Name", v.event), ...line("Datum", v.start_date), ...line("Uhrzeit", v.start_time), ...(withDuration ? line("Dauer", v.duration) : []), ...line("Ort", v.where)];
}

/** The docs and rulebook links, each on its own line. */
function links(input: PromptInput): string[] {
  return [...line("Infos zum Event", input.request.eventDocsUrl ?? ""), ...line("Regeln", input.settings.rulebookUrl ?? "")];
}

const qa = (items: { question: string; answer: string }[]): string[] => items.filter((i) => i.answer.trim()).map((i) => `${i.question}: ${i.answer}`);

/** The sections shared by the prompts: the style, an example and the closing instruction. */
const styleBlock = (style: string, fallback: string): string => block("Stil", [style.trim() || fallback]);
const exampleBlock = (heading: string, example: string): string => block(heading, example.trim() ? [example.trim()] : []);

function announcement(input: PromptInput): string {
  const { settings: s } = input;
  const info = join([
    "Alle Informationen zum Event",
    block("Zur Orientierung (nicht abschreiben)", facts(input, true)),
    block("Briefing", input.brief.trim() ? [input.brief.trim()] : []),
    block("Antworten des Planers", qa(input.answers)),
    block("Fallback-Pläne (Nicht in der Ankündigung nennen, nur zur Information)", input.fallback.filter((f) => f.title.trim()).map((f) => `- ${f.title.trim()}`)),
    block("Links", links(input)),
  ]);
  return join([
    "Du schreibst die Ankündigung für ein Community-Event.",
    styleBlock(s.announcementStyle, DEFAULT_STYLE_GUIDES.announcement),
    exampleBlock("Beispiel einer Ankündigung", s.announcementExample),
    info,
    "Schreibe die Ankündigung auf Deutsch. Beginne mit `# <Eventname>`, dann fließender Text in Absätzen, keine Stichpunktlisten, keine Kopie des Briefings.\nAusgabe: nur der reine Text der Ankündigung, ohne Kommentar davor oder danach.",
    PLACEHOLDER_GUIDE,
  ]);
}

/** The first sentence of the brief, as the one-sentence summary of the reminder. */
function summary(brief: string): string {
  const text = brief.replace(/^#.*$/gm, "").trim();
  const first = /^[^.!?\n]*[.!?]?/.exec(text)?.[0].trim() ?? "";
  return first;
}

function reminder(input: PromptInput): string {
  const { settings: s } = input;
  return join([
    "Du schreibst die kurze Erinnerung an ein Community-Event, das bald stattfindet.",
    styleBlock(s.announcementStyle, DEFAULT_STYLE_GUIDES.announcement),
    exampleBlock("Beispiel einer Erinnerung", s.reminderExample),
    block("Zur Orientierung (nicht abschreiben)", [...facts(input, false), ...line("Worum es geht", summary(input.brief)), ...links(input)]),
    "Schreibe die kurze Erinnerung auf Deutsch im gleichen Stil.\nAusgabe: nur der reine Text, ohne Kommentar davor oder danach.",
    PLACEHOLDER_GUIDE,
  ]);
}

function team(input: PromptInput): string {
  const { settings: s } = input;
  return join([
    "Du schreibst die Nachricht an das Team, das dieses Community-Event betreut.",
    styleBlock(s.teamStyle, DEFAULT_STYLE_GUIDES.team),
    exampleBlock("Beispiel einer Team-Nachricht", s.teamExample),
    block("Zur Orientierung (nicht abschreiben)", facts(input, true)),
    block("Briefing", input.brief.trim() ? [input.brief.trim()] : []),
    block("Moderation (Rollen und Anzahl, Chatregeln, was bestraft wird, verbotene Dinge, wer Bereitschaft hat)", qa(input.moderation)),
    block("Besetzung und weitere Antworten", qa(input.answers.filter((a) => !input.moderation.some((m) => m.question === a.question && m.answer === a.answer)))),
    block(
      "Fallback-Plan",
      input.fallback.flatMap((f) => (f.title.trim() ? [[f.title.trim(), ...line("Was wir tun", f.whatWeDo), ...line("Wer entscheidet", f.whoDecides)].join("\n")] : [])),
    ),
    block("Links", links(input)),
    "Schreibe die Team-Nachricht auf Deutsch.\nAusgabe: nur der reine Text, ohne Kommentar davor oder danach.",
    PLACEHOLDER_GUIDE,
  ]);
}

/** The prompt for the short description: one or two sentences, no placeholders, with the facts and the brief as context. */
function summaryPrompt(input: PromptInput): string {
  return join([
    "Du schreibst die Kurzbeschreibung für ein Community-Event.",
    block("Zur Orientierung (nicht abschreiben)", facts(input, true)),
    block("Briefing", input.brief.trim() ? [input.brief.trim()] : []),
    "Schreibe eine Kurzbeschreibung des Events auf Deutsch: ein bis zwei Sätze, höchstens 300 Zeichen, keine Platzhalter, keine Überschrift, kein Markdown. Ausgabe: nur der Text.",
  ]);
}

/** Builds the four copy prompts from `input`. Pure; missing data is left out together with its label. */
export function buildPrompts(input: PromptInput): Record<PromptKind, string> {
  return { announcement: announcement(input), reminder: reminder(input), team: team(input), summary: summaryPrompt(input) };
}
