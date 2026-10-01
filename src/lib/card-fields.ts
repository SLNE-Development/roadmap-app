/** Fields a board card can show; `gates` is the status towards the next column with entry rules. */
export const BUILTIN_CARD_FIELDS = ["owner", "tasks", "blocked", "phase", "domain", "priority", "questions", "estimate", "dependencies", "gates"] as const;

/** A card field: a built-in one, or `custom:<key>` for the custom field with that key. */
export type CardField = (typeof BUILTIN_CARD_FIELDS)[number] | `custom:${string}`;

/** Most fields one card shows. */
export const MAX_CARD_FIELDS = 8;

/** Fields cards show until a board chooses its own. */
export const DEFAULT_CARD_FIELDS: CardField[] = ["domain", "priority", "blocked", "tasks", "owner", "gates"];

/**
 * Keeps the valid fields of `raw` in order: drops unknown values, duplicates and custom
 * fields whose key is not in `customFieldKeys`, and caps the list at {@link MAX_CARD_FIELDS}.
 */
export function normalizeCardFields(raw: unknown, customFieldKeys: string[]): CardField[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set(customFieldKeys);
  const builtin = new Set<string>(BUILTIN_CARD_FIELDS);
  const seen = new Set<string>();
  const result: CardField[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || seen.has(value)) continue;
    if (!builtin.has(value) && !(value.startsWith("custom:") && keys.has(value.slice("custom:".length)))) continue;
    seen.add(value);
    result.push(value as CardField);
  }
  return result.slice(0, MAX_CARD_FIELDS);
}

/** Names of the built-in fields as the card fields dialog shows them. */
export const CARD_FIELD_LABELS: Record<(typeof BUILTIN_CARD_FIELDS)[number], string> = {
  owner: "Owner",
  tasks: "Task progress",
  blocked: "Blocked reason",
  phase: "Phase",
  domain: "Domain",
  priority: "Priority",
  questions: "Open questions",
  estimate: "Open points",
  dependencies: "Waiting on",
  gates: "Gates",
};
