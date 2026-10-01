"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PUSH_OFF } from "@/components/notifications/rules-table";
import { Button } from "@/components/ui/button";
import { enablePush, type PushSupport } from "@/lib/push-client";
import { useTRPC } from "@/trpc/client";

const MESSAGES: Record<Exclude<PushSupport, "supported">, string> = {
  denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then reload.",
  "ios-needs-home-screen":
    "On iPhone and iPad, push works from the home-screen app: tap Share → Add to Home Screen, open Roadmap from there, and enable it again.",
  unsupported: "This browser can't receive push notifications.",
};

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
      subscribe.mutate({ ...subscription, label }, { onSuccess: () => toast.success("Push notifications are on for this device"), onSettled: onEnabled });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not turn on push notifications.");
      onEnabled();
    } finally {
      setAsking(false);
    }
  }

  if (!pushEnabled) return <p className="px-4 pb-4 text-[13.5px] text-fg-2 sm:px-5">{PUSH_OFF}</p>;
  if (support === null || subscribed) return null;
  if (support !== "supported") return <p className="px-4 pb-4 text-[13.5px] text-fg-2 sm:px-5">{MESSAGES[support]}</p>;
  return (
    <div className="px-4 pb-4 sm:px-5">
      <Button onClick={() => key.data && enable(key.data)} disabled={asking || subscribe.isPending || !key.data}>
        Enable on this device
      </Button>
    </div>
  );
}
