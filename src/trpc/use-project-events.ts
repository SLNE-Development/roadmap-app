"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "./client";
import { openProjectEvents } from "./realtime";

/**
 * Refreshes the open project's queries when someone changes the project: listens to the project's change notices
 * and invalidates only the routers they name. Mount it once per project shell. Failures are silent.
 *
 * @param projectSlug the project slug
 */
export function useProjectEvents(projectSlug: string): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  useEffect(() => {
    const routers = trpc as unknown as Record<string, { pathFilter?: () => { queryKey: readonly unknown[] } } | undefined>;
    const events = openProjectEvents({
      createSource: () => new EventSource(`/api/events/${encodeURIComponent(projectSlug)}`),
      invalidate: (keys) => {
        for (const key of keys) void queryClient.invalidateQueries(routers[key]?.pathFilter?.() ?? { queryKey: [[key]] });
      },
    });
    const onVisibility = () => events.setVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      events.close();
    };
  }, [trpc, queryClient, projectSlug]);
}
