"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/** Starts the Discord OAuth flow; failures come back to `/login?error=…`. */
export function SignInButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({ provider: "discord", callbackURL: "/", errorCallbackURL: "/login?error=signin" });
      }}
    >
      {pending ? "Redirecting…" : "Sign in with Discord"}
    </Button>
  );
}
