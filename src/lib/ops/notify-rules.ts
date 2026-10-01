import type { Executor } from "@/db/types";
import {
  DEFAULT_NOTIFY_RULES,
  NOTIFY_RULES_PREF,
  storedNotifyRulesSchema,
  type NotifyRules,
} from "@/lib/notify-rules-schema";
import { getPref } from "./prefs";

export {
  ACTIVE_TTL_SECONDS,
  DEFAULT_NOTIFY_RULES,
  NOTIFY_RULES_PREF,
  activeKey,
  inQuietHours,
  notifyRulesSchema,
  pushDecision,
  quietEndsAt,
  wantsInbox,
  wantsPush,
  type NotifyRules,
} from "@/lib/notify-rules-schema";

/** Returns a user's notification rules: the stored value merged over the defaults, or the defaults when it is invalid. */
export async function readNotifyRules(tx: Executor, userId: string): Promise<NotifyRules> {
  const stored = storedNotifyRulesSchema.safeParse(await getPref(tx, userId, NOTIFY_RULES_PREF));
  if (!stored.success) return structuredClone(DEFAULT_NOTIFY_RULES);
  const { kinds, quiet, skipPushWhileActive } = stored.data;
  const defaults = structuredClone(DEFAULT_NOTIFY_RULES);
  return {
    kinds: { ...defaults.kinds, ...kinds },
    quiet: { ...defaults.quiet, ...quiet },
    skipPushWhileActive: skipPushWhileActive ?? defaults.skipPushWhileActive,
  };
}
