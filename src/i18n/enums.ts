/** The stored priority values and the `enums.priority` key that labels each. */
const PRIORITY_KEYS = { MVP: "mvp", Later: "later", "Nice to have": "niceToHave" } as const;

export type PriorityValue = keyof typeof PRIORITY_KEYS;
export type PriorityKey = (typeof PRIORITY_KEYS)[PriorityValue];

/** Returns the `enums.priority` message key for a stored priority value. */
export function priorityKey(value: PriorityValue): PriorityKey {
  return PRIORITY_KEYS[value];
}
