"use client";

import { LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/**
 * Starts the Discord OAuth flow. Callback failures come back to
 * `/login?error=<code>&error_description=…`; failures before the redirect are shown as a toast.
 */
export function SignInButton({ next }: { next: string }) {
  const t = useTranslations("login");
  const [pending, setPending] = useState(false);
  return (
    <Button
      className="h-[46px] w-full gap-2.5 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const { error } = await authClient.signIn.social({
            provider: "discord",
            callbackURL: next,
            // Better Auth appends `error=<code>` itself; a query here would make `error` repeat.
            errorCallbackURL: "/login",
          });
          if (error) {
            setPending(false);
            toast.error(error.message ?? t("signInFailed"));
          }
        } catch (thrown) {
          setPending(false);
          toast.error(thrown instanceof Error ? thrown.message : t("signInFailed"));
        }
      }}
    >
      <LogIn aria-hidden />
      {pending ? t("redirecting") : t("continueWithDiscord")}
    </Button>
  );
}
