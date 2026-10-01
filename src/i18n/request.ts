import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { sessionActor } from "@/lib/auth/actor";
import { getPref } from "@/lib/ops/prefs";
import { resolveLocale, resolveTimeZone, type Locale } from "./locale";

/** The message catalogue of the default language. */
export type Messages = typeof import("../../messages/en.json");

/**
 * Resolves the language, time zone and messages of one request from the user's `locale` and
 * `timeZone` preferences and the `Accept-Language` header.
 *
 * @param opts.db the database
 * @param opts.userId the signed-in user, or `null` without a session
 * @param opts.acceptLanguage the `Accept-Language` request header
 */
export async function loadRequestConfig(opts: {
  db: Db;
  userId: string | null;
  acceptLanguage: string | null;
}): Promise<{ locale: Locale; timeZone: string; messages: Messages }> {
  const [localePref, timeZonePref] = opts.userId
    ? await Promise.all([getPref(opts.db, opts.userId, "locale"), getPref(opts.db, opts.userId, "timeZone")])
    : [null, null];
  const locale = resolveLocale(localePref, opts.acceptLanguage);
  const messages = (await import(`../../messages/${locale}.json`)).default as Messages;
  return { locale, timeZone: resolveTimeZone(timeZonePref), messages };
}

export default getRequestConfig(async () => {
  const actor = await sessionActor();
  const config = await loadRequestConfig({
    db: getDb(),
    userId: actor?.userId ?? null,
    acceptLanguage: (await headers()).get("accept-language"),
  });
  return { ...config, now: new Date() };
});
