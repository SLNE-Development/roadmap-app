import { z } from "zod";

/** The kinds of question a developer can ask a requester. */
export const QUESTION_TYPES = ["text", "choice", "multi", "number", "date", "time", "yesno", "scale"] as const;

/** One of {@link QUESTION_TYPES}. */
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Limits on a round of questions. */
export const QUESTION_LIMITS = { perRound: 5, options: 8, textMax: 2000, whyMax: 500, optionMax: 100 } as const;

/** The longest free text a requester may add to a choice or multi answer through "Other". */
const OTHER_MAX = 500;

/** The question fields that decide how it is answered; the same shape is stored in `event_question.config`. */
export interface QuestionConfig {
  options?: string[];
  other?: boolean;
  min?: number;
  max?: number;
  unit?: string;
}

/** What {@link answerValueSchema} needs of a question: its type and config fields, flat. */
export interface QuestionSpec extends QuestionConfig {
  type: QuestionType;
}

/** The scale sizes a question may have; a scale always starts at 1, so `min` is not allowed. */
const SCALE_MAXES = [5, 10];

/** The config fields each type may use. */
const ALLOWED: Record<QuestionType, readonly (keyof QuestionConfig)[]> = {
  text: [],
  choice: ["options", "other"],
  multi: ["options", "other", "min", "max"],
  number: ["min", "max", "unit"],
  date: [],
  time: [],
  yesno: [],
  scale: ["max"],
};

/** The flat shape of an asked question, so the MCP schema stays small; per-type rules are enforced by {@link validateAsked}. */
const askedBase = z.object({
  type: z.enum(QUESTION_TYPES),
  /** The question itself. */
  text: z.string().trim().min(1).max(QUESTION_LIMITS.textMax),
  /** Why the team asks; shown under the question. */
  why: z.string().trim().max(QUESTION_LIMITS.whyMax).optional(),
  required: z.boolean().default(true),
  /** A pre-selected answer of the answer's own shape. */
  suggested: z.unknown().optional(),
  options: z.array(z.string().trim().min(1).max(QUESTION_LIMITS.optionMax)).max(QUESTION_LIMITS.options).optional(),
  other: z.boolean().default(false),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
});

/** A question as validated by {@link validateAsked}; only `type` and `text` are needed. */
export type AskedLike = Partial<z.input<typeof askedBase>> & Pick<z.input<typeof askedBase>, "type">;

/**
 * Checks the per-type rules of an asked question.
 *
 * @returns one message per problem, each naming the field; empty when the question is fine
 */
export function validateAsked(q: AskedLike): string[] {
  const errors: string[] = [];
  const allowed = ALLOWED[q.type];
  for (const field of ["options", "min", "max", "unit"] as const) {
    if (q[field] !== undefined && !allowed.includes(field)) errors.push(`${field} is not allowed for a ${q.type} question.`);
  }
  if (q.other === true && !allowed.includes("other")) errors.push(`other is not allowed for a ${q.type} question.`);
  if (q.type === "choice" || q.type === "multi") {
    const options = q.options ?? [];
    if (options.length < 2 || options.length > QUESTION_LIMITS.options) errors.push(`options needs 2 to ${QUESTION_LIMITS.options} entries for a ${q.type} question.`);
    if (new Set(options).size !== options.length) errors.push("options must not repeat an option.");
  }
  if (q.type === "multi") {
    const limit = (q.options?.length ?? 0) + (q.other ? 1 : 0);
    if (q.min !== undefined && (!Number.isInteger(q.min) || q.min < 0)) errors.push("min must be a whole number of 0 or more.");
    if (q.max !== undefined && (!Number.isInteger(q.max) || q.max < 1 || q.max > limit)) errors.push("max must be a whole number between 1 and the number of choices.");
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) errors.push("min must not be greater than max.");
    if (q.min !== undefined && Number.isInteger(q.min) && q.min > limit) errors.push("min must not be greater than the number of choices.");
  }
  if (q.type === "number" && q.min !== undefined && q.max !== undefined && q.min > q.max) errors.push("min must not be greater than max.");
  if (q.type === "scale" && q.max !== undefined && !SCALE_MAXES.includes(q.max)) errors.push("max must be 5 or 10 for a scale question.");
  if (errors.length === 0 && q.suggested !== undefined) {
    const result = answerValueSchema({ type: q.type, options: q.options, other: q.other, min: q.min, max: q.max }).safeParse(q.suggested);
    if (!result.success) errors.push(`suggested is not a valid answer: ${result.error.issues[0]?.message ?? "invalid"}.`);
  }
  return errors;
}

/** One question a developer asks: the flat input of `ask_requester` and `requests.askRound`. */
export const askedQuestionInput = askedBase.superRefine((q, ctx) => {
  for (const message of validateAsked(q)) ctx.addIssue({ code: "custom", message });
});

/** A round of one to five questions. */
export const askRoundInput = z.object({ questions: z.array(askedQuestionInput).min(1).max(QUESTION_LIMITS.perRound) });

/** Returns whether `value` is a real `YYYY-MM-DD` calendar date. */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Builds the schema of the answers a question accepts:
 * text a string; choice `{ option }` or `{ other }`; multi `{ options, other? }`; number a finite number;
 * date `YYYY-MM-DD`; time `HH:MM`; yesno a boolean; scale an integer from 1 to `max`.
 *
 * @param question its type and config fields
 */
export function answerValueSchema(question: QuestionSpec): z.ZodType<unknown> {
  const options = question.options ?? [];
  const other = z.string().trim().min(1).max(OTHER_MAX);
  switch (question.type) {
    case "text":
      return z.string().trim().min(1).max(QUESTION_LIMITS.textMax);
    case "choice": {
      const option = z.strictObject({ option: z.string().refine((v) => options.includes(v), "Pick one of the options.") });
      return question.other ? z.union([option, z.strictObject({ other })]) : option;
    }
    case "multi": {
      const min = question.min ?? 0;
      const max = question.max ?? options.length + (question.other ? 1 : 0);
      return z
        .strictObject({
          options: z.array(z.string().refine((v) => options.includes(v), "Pick only from the options.")),
          ...(question.other ? { other: other.optional() } : {}),
        })
        .superRefine((v, ctx) => {
          const picked = v.options.length + ("other" in v && v.other ? 1 : 0);
          if (new Set(v.options).size !== v.options.length) ctx.addIssue({ code: "custom", message: "Do not pick an option twice." });
          if (picked < min || picked > max) ctx.addIssue({ code: "custom", message: `Pick between ${min} and ${max}.` });
        });
    }
    case "number": {
      let n = z.number().finite();
      if (question.min !== undefined) n = n.min(question.min);
      if (question.max !== undefined) n = n.max(question.max);
      return n;
    }
    case "date":
      return z.string().refine(isCalendarDate, "Use a real date as YYYY-MM-DD.");
    case "time":
      return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time as HH:MM, 24 hours.");
    case "yesno":
      return z.boolean();
    case "scale":
      return z.number().int().min(1).max(question.max ?? 5);
  }
}
