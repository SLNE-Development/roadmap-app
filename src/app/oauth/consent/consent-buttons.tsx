"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/**
 * Allow and Deny for the consent page. The auth client sends the page's signed query with the
 * decision; the provider answers with the client's redirect, carrying the code or the denial.
 */
export function ConsentButtons() {
  const t = useTranslations("login.consent");
  const [pending, setPending] = useState(false);
  async function decide(accept: boolean) {
    setPending(true);
    const { data, error } = await authClient.oauth2.consent({ accept });
    const url = data && "url" in data ? data.url : null;
    if (error || !url) {
      setPending(false);
      toast.error(error?.message ?? t("failed"));
      return;
    }
    window.location.href = url;
  }
  return (
    <div className="flex gap-3">
      <Button className="flex-1" disabled={pending} onClick={() => decide(true)}>
        {t("allow")}
      </Button>
      <Button className="flex-1" variant="outline" disabled={pending} onClick={() => decide(false)}>
        {t("deny")}
      </Button>
    </div>
  );
}
