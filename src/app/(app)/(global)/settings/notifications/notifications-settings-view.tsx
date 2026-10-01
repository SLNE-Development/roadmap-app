"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Page, PageHeader, Panel } from "@/components/page";
import { QuietHours } from "@/components/notifications/quiet-hours";
import { RulesTable } from "@/components/notifications/rules-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_NOTIFY_RULES, type NotifyRules } from "@/lib/notify-rules-schema";
import { useTRPC } from "@/trpc/client";
import { DevicesSection } from "./devices-section";

/** The notification settings body: one draft of the rules, saved with one button. */
export function NotificationsSettingsView({ pushEnabled }: { pushEnabled: boolean }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.notifications.rules.queryOptions());
  const [rules, setRules] = useState<NotifyRules>(data);
  const [zoneChosen, setZoneChosen] = useState(false);
  const save = useMutation(trpc.notifications.setRules.mutationOptions({ onSuccess: () => toast.success("Saved") }));

  function submit() {
    // On the first save a zone nobody picked (still the UTC default) becomes the browser's.
    const untouched = !zoneChosen && rules.quiet.timeZone === DEFAULT_NOTIFY_RULES.quiet.timeZone;
    const next = untouched ? { ...rules, quiet: { ...rules.quiet, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } } : rules;
    setRules(next);
    save.mutate(next);
  }

  return (
    <Page width="medium">
      <PageHeader crumbs={[{ label: "Account" }]} title="Notification settings" description="Choose what reaches your inbox and what is pushed to your devices." />
      <div className="flex flex-col gap-5" aria-busy={save.isPending}>
        <Panel title="Notifications">
          <RulesTable
            kinds={rules.kinds}
            pushEnabled={pushEnabled}
            onChange={(kind, channel, value) => setRules((r) => ({ ...r, kinds: { ...r.kinds, [kind]: { ...r.kinds[kind], [channel]: value } } }))}
          />
        </Panel>
        <Panel title="Quiet hours" meta="Pushes wait until quiet hours end">
          <QuietHours
            quiet={rules.quiet}
            onChange={(quiet) => {
              if (quiet.timeZone !== rules.quiet.timeZone) setZoneChosen(true);
              setRules((r) => ({ ...r, quiet }));
            }}
          />
        </Panel>
        <Panel title="While you are using the app">
          <div className="flex items-center gap-3 px-4 pb-4 sm:px-5">
            <Switch id="skip-active" checked={rules.skipPushWhileActive} onCheckedChange={(skipPushWhileActive) => setRules((r) => ({ ...r, skipPushWhileActive }))} />
            <Label htmlFor="skip-active">Don&apos;t push while I&apos;m using the app</Label>
          </div>
        </Panel>
        <div>
          <Button onClick={submit} disabled={save.isPending}>
            Save
          </Button>
        </div>
        <DevicesSection pushEnabled={pushEnabled} />
      </div>
    </Page>
  );
}
