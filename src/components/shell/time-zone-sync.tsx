"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTimeZone } from "next-intl";
import { useEffect } from "react";
import { resolveTimeZone } from "@/i18n/locale";
import { useTRPC } from "@/trpc/client";

/** The sessionStorage key marking that the browser's time zone was already sent in this session. */
const SYNCED_KEY = "roadmap.timeZoneSynced";

/**
 * Stores the browser's time zone as the user's `timeZone` preference when it differs from the one the server
 * rendered with, once per session, and refreshes the page so times show in local time. Renders nothing.
 */
export function TimeZoneSync() {
  const router = useRouter();
  const trpc = useTRPC();
  const serverZone = useTimeZone();
  const setTimeZone = useMutation(trpc.account.setTimeZone.mutationOptions({ onSuccess: () => router.refresh() }));
  const { mutate } = setTimeZone;
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserZone || browserZone === serverZone || resolveTimeZone(browserZone) !== browserZone) return;
    try {
      if (sessionStorage.getItem(SYNCED_KEY)) return;
      sessionStorage.setItem(SYNCED_KEY, "1");
    } catch {
      // Without sessionStorage the guard is skipped; the preference still settles after the first refresh.
    }
    mutate({ timeZone: browserZone });
  }, [serverZone, mutate]);
  return null;
}
