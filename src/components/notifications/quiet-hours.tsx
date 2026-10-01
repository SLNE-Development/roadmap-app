"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { NotifyRules } from "@/lib/notify-rules-schema";

/** The quiet hours settings: an enable switch, start and end times and a time zone. */
export function QuietHours({ quiet, onChange }: { quiet: NotifyRules["quiet"]; onChange: (quiet: NotifyRules["quiet"]) => void }) {
  const t = useTranslations("notifications.quietHours");
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(quiet.timeZone) ? all : [quiet.timeZone, ...all];
  }, [quiet.timeZone]);
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5">
      <div className="flex items-center gap-3">
        <Switch id="quiet-enabled" checked={quiet.enabled} onCheckedChange={(enabled) => onChange({ ...quiet, enabled })} />
        <Label htmlFor="quiet-enabled">{t("hold")}</Label>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quiet-start">{t("from")}</Label>
          <Input id="quiet-start" type="time" className="w-32" value={quiet.start} disabled={!quiet.enabled} onChange={(e) => e.target.value && onChange({ ...quiet, start: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quiet-end">{t("to")}</Label>
          <Input id="quiet-end" type="time" className="w-32" value={quiet.end} disabled={!quiet.enabled} onChange={(e) => e.target.value && onChange({ ...quiet, end: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quiet-zone">{t("timeZone")}</Label>
          <NativeSelect id="quiet-zone" value={quiet.timeZone} disabled={!quiet.enabled} onChange={(e) => onChange({ ...quiet, timeZone: e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
    </div>
  );
}
