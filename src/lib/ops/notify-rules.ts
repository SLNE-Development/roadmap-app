import type { NotificationKind } from "@/db/schema";
import type { Executor } from "@/db/types";

/** A user's notification rules. Placeholder until personal rules exist: every kind goes to the inbox and to push. */
export type NotifyRules = Record<string, never>;

/** Returns a user's notification rules. */
export async function readNotifyRules(tx: Executor, userId: string): Promise<NotifyRules> {
  void [tx, userId];
  return {};
}

/** Returns whether `kind` goes to the inbox under `rules`. */
export function wantsInbox(rules: NotifyRules, kind: NotificationKind): boolean {
  void [rules, kind];
  return true;
}

/** Returns whether `kind` may be pushed under `rules`. */
export function wantsPush(rules: NotifyRules, kind: NotificationKind): boolean {
  void [rules, kind];
  return true;
}
