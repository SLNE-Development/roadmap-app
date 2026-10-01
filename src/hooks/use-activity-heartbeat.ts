"use client";

import { useEffect, useRef } from "react";
import { useTRPCClient } from "@/trpc/client";

const INTERVAL_MS = 60_000;

/** Tells the server the user is active: on mount, every minute while the tab is visible and when it becomes visible again. */
export function useActivityHeartbeat(): void {
  // The vanilla client, so the mutation cache neither toasts a failed beat nor refetches queries after each one.
  const client = useTRPCClient();
  const beat = useRef(() => client.notifications.heartbeat.mutate().catch(() => {}));
  useEffect(() => {
    beat.current = () => client.notifications.heartbeat.mutate().catch(() => {});
  }, [client]);
  useEffect(() => {
    const send = () => {
      if (document.visibilityState === "visible") beat.current();
    };
    send();
    const timer = setInterval(send, INTERVAL_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
    };
  }, []);
}
