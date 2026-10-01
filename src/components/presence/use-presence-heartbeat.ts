"use client";

import { useEffect } from "react";

const INTERVAL_MS = 30_000;

/**
 * Tells the server the user views a system: on mount and every 30 s while the tab is visible, and with a beacon when
 * the page is hidden or the component unmounts. Errors are ignored.
 */
export function usePresenceHeartbeat(project: string, system: string): void {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/presence", { method: "POST", body: JSON.stringify({ project, system }), keepalive: true }).catch(() => {});
    };
    const leave = () => {
      try {
        navigator.sendBeacon("/api/presence", JSON.stringify({ project, system, leaving: true }));
      } catch {
        // presence is best effort
      }
    };
    beat();
    const timer = setInterval(beat, INTERVAL_MS);
    window.addEventListener("pagehide", leave);
    // A tab hidden for over a minute has dropped out of others' views, so it beats the moment it is shown again.
    document.addEventListener("visibilitychange", beat);
    // Restored from the back/forward cache: the page never remounted, so no effect ran.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) beat();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("pageshow", onPageShow);
      leave();
    };
  }, [project, system]);
}
