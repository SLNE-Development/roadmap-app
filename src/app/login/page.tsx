import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { SignInButton } from "./sign-in-button";

/** The public entry page. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("title"), alternates: { canonical: "/login" } };
}

/**
 * The `login.errors` key for each lower-cased `?error=` code the Better Auth OAuth callback
 * redirects with. `not_provisioned` is the code our session hook throws for accounts
 * missing from the allowlist; `unable_to_create_session` is what Better Auth sends when a
 * hook vetoes the session without a code.
 */
const ERROR_KEYS = {
  not_provisioned: "notOnAllowlist",
  unable_to_create_session: "notOnAllowlist",
  access_denied: "cancelled",
  state_mismatch: "restart",
  state_not_found: "restart",
  state_invalid: "restart",
  please_restart_the_process: "restart",
  unable_to_get_user_info: "noUserInfo",
} as const;

/** Returns the `login.errors` key for an error code; unknown codes get the generic message (the code is shown separately). */
function messageKey(code: string): { key: (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS] | "generic"; known: boolean } {
  const key = code.toLowerCase();
  const provisioning = key.includes("not_been_added") || key.includes("allowlist") || key.includes("provision");
  const found = provisioning ? "notOnAllowlist" : ERROR_KEYS[key as keyof typeof ERROR_KEYS];
  return found ? { key: found, known: true } : { key: "generic", known: false };
}

/** The wave lines of the brand panel: gentle quadratic waves growing taller towards the bottom. */
const WAVES = Array.from({ length: 14 }, (_, i) => {
  const y = 420 + i * 34;
  const a = 14 + i * 1.5;
  let d = `M-20 ${y}`;
  for (let x = -20; x < 840; x += 80) d += ` q 40 ${-a} 80 0`;
  return d;
});

/** The Roadmap logo: two waves on a teal square, then the word mark. */
function Logo() {
  return (
    <div className="relative flex items-center gap-3">
      <span className="flex size-[34px] items-center justify-center bg-primary text-primary-foreground">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
          <path d="M2 9c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
        </svg>
      </span>
      <span className="font-display text-[22px] font-bold">Roadmap</span>
    </div>
  );
}

/**
 * Sign-in page: a brand panel with the product's promise beside the Discord
 * button and, after a failed attempt, the reason in plain words. On phones the
 * panel shrinks to a band above the form.
 *
 * @param props.searchParams carries `error` after a rejected sign-in and `next`, the page to return to
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; next?: string | string[] }> }) {
  const [params, t] = await Promise.all([searchParams, getTranslations("login")]);
  // A repeated `error` arrives as an array; the last one is the most specific.
  const error = Array.isArray(params.error) ? params.error.at(-1) : params.error;
  const message = error ? messageKey(error) : null;
  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-background text-foreground lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-none">
      <section className="relative flex flex-col justify-between gap-8 overflow-hidden bg-brand-strong px-6 py-7 text-primary-foreground sm:px-10 sm:py-10 lg:px-16 lg:py-14 dark:bg-brand-soft dark:text-foreground">
        <svg
          aria-hidden
          width="100%"
          height="100%"
          viewBox="0 0 800 900"
          preserveAspectRatio="none"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="absolute inset-0 text-primary-foreground opacity-[0.16] dark:text-brand-strong dark:opacity-[0.18]"
        >
          {WAVES.map((d) => (
            <path key={d} d={d} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <Logo />
        <div className="relative flex max-w-[520px] flex-col gap-4">
          <h1 className="font-display text-[30px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[40px] lg:text-[56px] lg:leading-[1.02]">
            {t("headline")}
          </h1>
          <p className="hidden text-base leading-[1.55] opacity-80 sm:block">
            {t("tagline")}
          </p>
        </div>
      </section>
      <section className="flex items-start justify-center px-4 py-10 sm:px-12 lg:items-center">
        <div className="flex w-full max-w-[380px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-[30px] font-semibold tracking-[-0.02em]">{t("title")}</h2>
            <p className="text-sm leading-normal text-fg-2">{t("subtitle")}</p>
          </div>
          <SignInButton next={safeNextPath(params.next)} />
          {message && (
            <div role="alert" className="flex gap-2.5 bg-danger-soft px-3.5 py-3 text-[13px] leading-normal text-destructive">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              <span>
                {t(`errors.${message.key}`)}
                {!message.known && <span className="mt-1 block font-mono text-xs">{error}</span>}
              </span>
            </div>
          )}
          <p className="text-[12.5px] text-muted-foreground">{t("apiKeyHint")}</p>
        </div>
      </section>
    </main>
  );
}
