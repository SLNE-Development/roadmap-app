"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { enablePush, type PushSupport } from "@/lib/push-client";
import { useTRPC } from "@/trpc/client";

/** The message key (under `notifications.push`) explaining each unsupported state. */
const MESSAGE_KEYS = {
  denied: "denied",
  "ios-needs-home-screen": "iosNeedsHomeScreen",
  unsupported: "unsupported",
} as const satisfies Record<Exclude<PushSupport, "supported">, string>;

/**
 * What this browser's push state asks of the user: a button to turn pushes on, or why it cannot. Shows nothing
 * while the state is unknown or once this browser is subscribed.
 *
 * @param support this browser's push support, or null while it is being checked
 * @param subscribed whether this browser is one of the user's devices
 * @param onEnabled called after an attempt to turn pushes on, so the browser state is read again
 */
export function EnablePush({
  pushEnabled,
  support,
  subscribed,
  onEnabled,
}: {
  pushEnabled: boolean;
  support: PushSupport | null;
  subscribed: boolean;
  onEnabled: () => void;
}) {
  const t = useTranslations("notifications.push");
  const trpc = useTRPC();
  const key = useQuery(trpc.notifications.pushKey.queryOptions(undefined, { enabled: pushEnabled }));
  const subscribe = useMutation(trpc.notifications.subscribe.mutationOptions());
  const [asking, setAsking] = useState(false);

  async function enable(publicKey: string) {
    setAsking(true);
    try {
      // Asks for permission before any await; only ever called from this click handler.
      const { subscription, label } = await enablePush(publicKey);
      // A failed save is toasted by the global mutation handler.
      subscribe.mutate({ ...subscription, label }, { onSuccess: () => toast.success(t("enabled")), onSettled: onEnabled });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("enableFailed"));
      onEnabled();
    } finally {
      setAsking(false);
    }
  }

  if (!pushEnabled) return <p className="px-4 pb-4 text-[13.5px] text-fg-2 sm:px-5">{t("off")}</p>;
  if (support === null || subscribed) return null;
  if (support !== "supported") return <p className="px-4 pb-4 text-[13.5px] text-fg-2 sm:px-5">{t(MESSAGE_KEYS[support])}</p>;
  return (
    <div className="px-4 pb-4 sm:px-5">
      <Button onClick={() => key.data && enable(key.data)} disabled={asking || subscribe.isPending || !key.data}>
        {t("enable")}
      </Button>
    </div>
  );
}
