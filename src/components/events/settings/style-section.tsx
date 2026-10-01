"use client";

import { useTranslations } from "next-intl";
import { AreaField } from "@/components/events/settings/fields";
import { SectionCard, type SectionProps } from "@/components/events/settings/section-card";
import { useSectionDraft } from "@/components/events/settings/use-section-draft";
import { FieldGroup } from "@/components/ui/field";
import { DEFAULT_STYLE_GUIDES } from "@/lib/event-templates";
import type { EventSettingsView } from "@/lib/ops/event-settings";

/** Writing style: the style guides and examples the copy prompts carry, for the announcement and reminder and for the team message. */
export function StyleSection({ settings, canManage }: SectionProps & { settings: EventSettingsView }) {
  const ts = useTranslations("events.settings");
  const form = useSectionDraft(
    {
      announcementStyle: settings.announcementStyle,
      announcementExample: settings.announcementExample,
      reminderExample: settings.reminderExample,
      teamStyle: settings.teamStyle,
      teamExample: settings.teamExample,
    },
    (d) => d,
  );
  const { draft } = form;
  return (
    <SectionCard id="style" title={ts("styleTitle")} help={ts("styleIntro")} save={canManage ? { dirty: form.dirty, pending: form.pending, onSave: form.save, onDiscard: form.discard } : undefined}>
      <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
        <FieldGroup>
          <h3 className="text-sm font-semibold">{ts("announcementTitle")}</h3>
          <AreaField label={ts("announcementStyle")} help={ts("styleHelp")} value={draft.announcementStyle} placeholder={DEFAULT_STYLE_GUIDES.announcement} disabled={!canManage} onChange={(v) => form.patch({ announcementStyle: v })} />
          <AreaField label={ts("announcementExample")} value={draft.announcementExample} disabled={!canManage} onChange={(v) => form.patch({ announcementExample: v })} />
          <AreaField label={ts("reminderExample")} value={draft.reminderExample} disabled={!canManage} onChange={(v) => form.patch({ reminderExample: v })} />
        </FieldGroup>
        <FieldGroup>
          <h3 className="text-sm font-semibold">{ts("teamTitle")}</h3>
          <AreaField label={ts("teamStyle")} help={ts("styleHelp")} value={draft.teamStyle} placeholder={DEFAULT_STYLE_GUIDES.team} disabled={!canManage} onChange={(v) => form.patch({ teamStyle: v })} />
          <AreaField label={ts("teamExample")} value={draft.teamExample} disabled={!canManage} onChange={(v) => form.patch({ teamExample: v })} />
        </FieldGroup>
      </div>
    </SectionCard>
  );
}
