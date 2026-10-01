import { z } from "zod";
import { LOCALES } from "@/i18n/locale";
import { notifyRulesSchema, timeZoneSchema } from "./notify-rules-schema";

/** The collapsed columns and lanes of one board; lane entries read `<laneKind>:<laneKey>`. */
export const BOARD_COLLAPSED_SCHEMA = z.object({ columns: z.array(z.string()).max(50), lanes: z.array(z.string()).max(100) });

/**
 * Value schemas of the known preferences, by key. A key ending in a pattern
 * entry also matches `<key>.<suffix>`, such as `board.collapsed.<boardId>`.
 */
export const PREF_SCHEMAS: Record<string, z.ZodType> = {
  "overview.panels": z.object({ order: z.array(z.string()).max(20), hidden: z.array(z.string()).max(20) }),
  "board.collapsed": BOARD_COLLAPSED_SCHEMA,
  "mywork.seenAt": z.string().datetime(),
  "notify.rules": notifyRulesSchema,
  locale: z.enum(LOCALES),
  timeZone: timeZoneSchema,
};

/**
 * Returns the schema of a preference key: an exact match first, then the longest
 * entry that is a prefix of the key followed by a dot.
 *
 * @returns the schema, or `null` for an unknown key
 */
export function prefSchema(key: string): z.ZodType | null {
  if (Object.hasOwn(PREF_SCHEMAS, key)) return PREF_SCHEMAS[key];
  const prefix = Object.keys(PREF_SCHEMAS)
    .filter((p) => key.startsWith(`${p}.`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? PREF_SCHEMAS[prefix] : null;
}
