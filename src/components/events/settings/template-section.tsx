"use client";

import { useTranslations } from "next-intl";
import { EmbedTemplateEditor } from "@/components/events/embed-template-editor";
import { SectionCard, type SectionProps } from "@/components/events/settings/section-card";
import { useSectionDraft } from "@/components/events/settings/use-section-draft";
import type { DetailsTemplate, EmbedTemplate } from "@/lib/event-templates";
import type { EventSettingsView } from "@/lib/ops/event-settings";

/** What a template section needs besides the settings: the signature and zone its preview uses. */
type TemplateSectionProps = SectionProps & { settings: EventSettingsView };

/** The Störfall, resolved or cancelled message: title, text and colour with a live preview; the Störfall one also holds the shared image. */
export function EmbedTemplateSection({ kind, settings, canManage }: TemplateSectionProps & { kind: "disaster" | "resolved" | "cancelled" }) {
  const ts = useTranslations("events.settings");
  const field = `${kind}Template` as const;
  const form = useSectionDraft<{ template: EmbedTemplate }>({ template: settings[field] }, (d) => ({ [field]: d.template }));
  return (
    <SectionCard id={kind} title={ts(`${kind}Title`)} help={ts(`${kind}Help`)} save={canManage ? { dirty: form.dirty, pending: form.pending, onSave: form.save, onDiscard: form.discard } : undefined}>
      <EmbedTemplateEditor
        kind={kind}
        value={form.draft.template}
        sharedImageId={settings.disasterTemplate.imageUploadId}
        disabled={!canManage}
        postAs={settings.postAs} postAvatarUrl={settings.postAvatarUrl}
        timeZone={settings.timeZone}
        onChange={(template) => form.patch({ template })}
        onImageChange={(imageUploadId) => form.patch((d) => ({ template: { ...d.template, imageUploadId } }))}
      />
    </SectionCard>
  );
}

/** The details message: a line per fact and a footer with a live preview. */
export function DetailsTemplateSection({ settings, canManage }: TemplateSectionProps) {
  const ts = useTranslations("events.settings");
  const form = useSectionDraft<{ template: DetailsTemplate }>({ template: settings.detailsTemplate }, (d) => ({ detailsTemplate: d.template }));
  return (
    <SectionCard id="details" title={ts("detailsTitle")} help={ts("detailsHelp")} save={canManage ? { dirty: form.dirty, pending: form.pending, onSave: form.save, onDiscard: form.discard } : undefined}>
      <EmbedTemplateEditor kind="details" value={form.draft.template} disabled={!canManage} postAs={settings.postAs} postAvatarUrl={settings.postAvatarUrl} timeZone={settings.timeZone} onChange={(template) => form.patch({ template })} />
    </SectionCard>
  );
}
