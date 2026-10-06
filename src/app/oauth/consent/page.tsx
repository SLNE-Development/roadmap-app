import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/actor";
import { consentRequest } from "@/lib/auth/consent";
import { ConsentButtons } from "./consent-buttons";

/** Not indexed; reached only from an OAuth authorization request. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login.consent");
  return { title: t("title"), robots: { index: false } };
}

/** Rebuilds the query string from Next's parsed search params; the signature check is order-insensitive. */
function queryOf(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  return query.toString();
}

/**
 * Consent page of the OAuth provider: names the MCP client asking to act as the signed-in
 * user and where the grant goes, with Allow and Deny. A forged or expired request shows an
 * error and offers nothing to grant.
 *
 * @param props.searchParams the provider's signed authorization query
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, t] = await Promise.all([searchParams, getTranslations("login.consent")]);
  const query = queryOf(params);
  if (!(await sessionActor())) redirect(`/login?${query}`);
  const request = await consentRequest(query);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col gap-5 border bg-card p-6 sm:p-8">
        {request ? (
          <>
            <h1 className="font-display text-[22px] leading-tight font-semibold text-balance">{t("heading", { client: request.clientName })}</h1>
            <p className="text-sm text-muted-foreground">{t("body")}</p>
            {request.redirectHost && <p className="text-sm text-muted-foreground">{t("redirect", { host: request.redirectHost })}</p>}
            <ConsentButtons />
            <p className="text-xs text-muted-foreground">{t("revokeHint")}</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-[22px] font-semibold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground" role="alert">
              {t("invalid")}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
