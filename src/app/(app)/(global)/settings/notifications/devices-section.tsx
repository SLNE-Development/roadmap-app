"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { EnablePush } from "@/components/notifications/enable-push";
import { PushDevices } from "@/components/notifications/push-devices";
import { Panel } from "@/components/page";
import { currentEndpointHash, pushSupport, registerPushWorker } from "@/lib/push-client";
import { plural } from "@/lib/text";
import { useTRPC } from "@/trpc/client";

/** Query key of this browser's push state, read in the browser only. */
const PUSH_CLIENT_KEY = ["push-client"];

/** The push devices section: this browser's push state above the list of the user's devices. */
export function DevicesSection({ pushEnabled }: { pushEnabled: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const browser = useQuery({
    queryKey: PUSH_CLIENT_KEY,
    queryFn: async () => ({ support: pushSupport(), endpointHash: await currentEndpointHash().catch(() => null) }),
    staleTime: Infinity,
  });
  const devices = useQuery(
    trpc.notifications.devices.queryOptions(
      { endpointHash: browser.data?.endpointHash ?? null },
      { enabled: browser.isFetched, placeholderData: (previous) => previous },
    ),
  );
  const supported = pushEnabled && browser.data?.support === "supported";
  useEffect(() => {
    // Registered ahead of the click, so enabling push only waits for the permission prompt.
    if (supported) registerPushWorker().catch((error: unknown) => console.error(error));
  }, [supported]);
  const list = devices.data ?? [];
  // Without the device list this browser counts as not subscribed, so the button still shows.
  const settled = devices.data !== undefined || devices.isError;
  return (
    <div id="devices">
      <Panel title="Devices" meta={devices.data ? plural(list.length, "device") : undefined}>
        <EnablePush
          pushEnabled={pushEnabled}
          // Unknown until the devices tell whether this browser is one of them.
          support={settled ? (browser.data?.support ?? null) : null}
          subscribed={list.some((d) => d.current)}
          onEnabled={() => queryClient.invalidateQueries({ queryKey: PUSH_CLIENT_KEY })}
        />
        {devices.data && <PushDevices devices={list} pushEnabled={pushEnabled} />}
        {devices.isError && !devices.data && <p className="px-4 pb-4 text-[13.5px] text-destructive sm:px-5">Your devices could not be loaded. Reload the page to try again.</p>}
      </Panel>
    </div>
  );
}
