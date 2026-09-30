import { CircleAlert } from "lucide-react";
import { SignInButton } from "./sign-in-button";

/** Human messages for the error codes Better Auth and the sign-in button put in `?error=`. */
const ERROR_MESSAGES: Record<string, string> = {
  not_provisioned: "That Discord account isn’t on the allowlist yet. Ask an admin to add it, then try again.",
  forbidden: "That Discord account isn’t on the allowlist yet. Ask an admin to add it, then try again.",
  unable_to_create_session: "That Discord account isn’t on the allowlist yet. Ask an admin to add it, then try again.",
  signin: "Sign-in failed. If your Discord account hasn’t been added yet, ask an admin. Otherwise try again.",
  access_denied: "Discord sign-in was cancelled. Try again when you’re ready.",
  state_mismatch: "The sign-in took too long or was started in another tab. Please try again.",
  please_restart_the_process: "The sign-in took too long or was started in another tab. Please try again.",
  unable_to_get_user_info: "Discord didn’t send your account details. Please try again.",
};

/** Returns the message for an error code; unknown codes get a generic message (the code is shown separately). */
function messageFor(code: string): { text: string; known: boolean } {
  const key = code.toLowerCase();
  const provisioning = key.includes("not_been_added") || key.includes("allowlist") || key.includes("provision");
  const text = provisioning ? ERROR_MESSAGES.not_provisioned : ERROR_MESSAGES[key];
  return text ? { text, known: true } : { text: "Sign-in failed. Please try again, or ask an admin if it keeps happening.", known: false };
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
 * @param props.searchParams carries `error` after a rejected sign-in
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? messageFor(error) : null;
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
            Plans your team and your agents both read.
          </h1>
          <p className="hidden text-base leading-[1.55] opacity-80 sm:block">
            Boards, planning interviews, specs and decisions for every Surf project, in one place.
          </p>
        </div>
      </section>
      <section className="flex items-start justify-center px-4 py-10 sm:px-12 lg:items-center">
        <div className="flex w-full max-w-[380px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-[30px] font-semibold tracking-[-0.02em]">Sign in</h2>
            <p className="text-sm leading-normal text-fg-2">Use the Discord account an admin added to the allowlist.</p>
          </div>
          <SignInButton />
          {message && (
            <div role="alert" className="flex gap-2.5 bg-danger-soft px-3.5 py-3 text-[13px] leading-normal text-destructive">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              <span>
                {message.text}
                {!message.known && <span className="mt-1 block font-mono text-xs">{error}</span>}
              </span>
            </div>
          )}
          <p className="text-[12.5px] text-muted-foreground">Agents connect with an API key instead. Create one under API keys after signing in.</p>
        </div>
      </section>
    </main>
  );
}
