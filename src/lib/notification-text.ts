import { createTranslator } from "use-intl/core";
import { resolveLocale } from "@/i18n/locale";
import de from "../../messages/de/notifications.json";
import en from "../../messages/en/notifications.json";

/** The notification texts of every language; imported without the Next.js request config so the worker can use them. */
const MESSAGES = { en: { notifications: en }, de: { notifications: de } };

/** The keys of `notifications.text`: one per notification title that code outside the UI composes. */
export type NotificationTextKey = keyof typeof en.text;

/** A notification title to render in the recipient's language: a message key and its values. */
export interface NotificationText {
  key: NotificationTextKey;
  values?: Record<string, string | number>;
}

/**
 * The `actor` (and `agent`, for an agent's write) values of a title that names who caused the notice.
 * An empty `actor` renders as the translated "someone" when the title is rendered.
 */
export function actorValues(name: string | null | undefined, agent: string | null | undefined): Record<string, string> {
  return { actor: name?.trim() ?? "", ...(agent ? { agent } : {}) };
}

/**
 * Renders a notification title in the language of the recipient's `locale` preference (English when unset or unknown).
 *
 * @param localePref the recipient's stored `locale` preference, of any shape
 * @param text the message key and values
 */
export function renderNotificationText(localePref: unknown, text: NotificationText): string {
  const locale = resolveLocale(localePref, null);
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "notifications.text" });
  const translate = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const { agent, ...values } = text.values ?? {};
  if (values.actor === "") values.actor = translate("unknownActor");
  // An agent's write reads "<agent> for <name>" in the recipient's language.
  if (typeof agent === "string" && typeof values.actor === "string") values.actor = translate("actorForAgent", { agent, name: values.actor });
  return translate(text.key, values);
}
