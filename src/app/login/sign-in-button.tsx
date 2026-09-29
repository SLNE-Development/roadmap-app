"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/** Starts the Discord OAuth flow; failures come back to `/login?error=…` or are shown as a toast. */
export function SignInButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const { error } = await authClient.signIn.social({
            provider: "discord",
            callbackURL: "/",
            errorCallbackURL: "/login?error=signin",
          });
          if (error) {
            setPending(false);
            toast.error(error.message ?? "Sign-in failed.");
          }
        } catch (thrown) {
          setPending(false);
          toast.error(thrown instanceof Error ? thrown.message : "Sign-in failed.");
        }
      }}
    >
      {pending ? "Redirecting…" : "Sign in with Discord"}
    </Button>
  );
}
