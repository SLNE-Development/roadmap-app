/** Whether the server refused a move because the target column's entry rules are unmet (a CONFLICT whose message starts with "Can't move"). */
export function isGateRefusal(error: unknown): boolean {
  const { data, message } = (error ?? {}) as { data?: { code?: string }; message?: unknown };
  return data?.code === "CONFLICT" && typeof message === "string" && message.startsWith("Can't move");
}

/**
 * Classifies a failed move: `"planning-gate"` when the server refused it because
 * planning is incomplete (a CONFLICT saying the system is still in planning),
 * `"other"` for anything else, such as permissions or network errors.
 */
export function moveErrorKind(error: unknown): "planning-gate" | "other" {
  const { data, message } = (error ?? {}) as { data?: { code?: string }; message?: unknown };
  return data?.code === "CONFLICT" && typeof message === "string" && message.includes("still in planning") ? "planning-gate" : "other";
}
