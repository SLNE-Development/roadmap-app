"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The Discord id of an account that signed in with Discord but is not on the allowlist, with a Copy button and the
 * instruction to send it to an admin. Shown only to that person; renders nothing without an id.
 */
export function RejectedAccount({ discordId }: { discordId: string | null }) {
  const t = useTranslations("login.rejected");
  const [copied, setCopied] = useState(false);
  if (!discordId) return null;
  return (
    <div role="status" className="flex flex-col gap-2 border bg-secondary px-3.5 py-3 text-[13px] leading-normal">
      <span className="font-semibold">{t("yourId")}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{discordId}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(discordId);
              setCopied(true);
            } catch {
              // Clipboard access can be refused; the id stays selectable on the page.
            }
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
      <span className="text-fg-2">{t("sendToAdmin")}</span>
    </div>
  );
}
