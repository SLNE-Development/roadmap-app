"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { DiscordPreview } from "@/components/events/discord-preview";
import { ImageUpload } from "@/components/events/image-upload";
import { TextField } from "@/components/events/settings/fields";
import { SectionCard, type SectionProps } from "@/components/events/settings/section-card";
import { useSectionDraft } from "@/components/events/settings/use-section-draft";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { EventSettingsView } from "@/lib/ops/event-settings";

/** Posting: the post-as name, ping role, server, time zone and rulebook link; empty text stands for "not set" where the column is nullable. */
export function PostingSection({ settings, canManage }: SectionProps & { settings: EventSettingsView }) {
  const ts = useTranslations("events.settings");
  const locale = useLocale();
  const zonesId = useId();
  const timeZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const form = useSectionDraft(
    { postAs: settings.postAs, avatar: settings.postAvatarUploadId ? { id: settings.postAvatarUploadId, url: settings.postAvatarUrl ?? "" } : null, pingRoleId: settings.pingRoleId ?? "", guildId: settings.guildId ?? "", timeZone: settings.timeZone, rulebookUrl: settings.rulebookUrl ?? "" },
    (d) => ({ postAs: d.postAs, postAvatarUploadId: d.avatar?.id ?? null, pingRoleId: d.pingRoleId.trim() || null, guildId: d.guildId.trim() || null, timeZone: d.timeZone, rulebookUrl: d.rulebookUrl.trim() || null }),
  );
  const { draft } = form;
  return (
    <SectionCard id="posting" title={ts("postingTitle")} help={ts("postingHelp")} save={canManage ? { dirty: form.dirty, pending: form.pending, onSave: form.save, onDiscard: form.discard } : undefined}>
      <FieldGroup>
        <TextField label={ts("postAs")} help={ts("postAsHelp")} value={draft.postAs} maxLength={80} disabled={!canManage} onChange={(v) => form.patch({ postAs: v })} />
        <Field>
          <FieldLabel>{ts("avatar")}</FieldLabel>
          <ImageUpload
            requestId={null}
            purpose="template"
            image={draft.avatar}
            previewClassName="size-20 rounded-full border object-cover"
            disabled={!canManage}
            onUploaded={(image) => form.patch({ avatar: { id: image.id, url: image.url } })}
            onRemove={() => form.patch({ avatar: null })}
          />
          <FieldDescription>{ts("avatarHelp")}</FieldDescription>
        </Field>
        <DiscordPreview parts={[{ kind: "text", content: ts("avatarSample") }]} postAs={draft.postAs} avatarUrl={draft.avatar?.url} locale={locale} timeZone={settings.timeZone} />
        <TextField label={ts("pingRoleId")} help={ts("pingRoleIdHelp")} value={draft.pingRoleId} maxLength={21} inputMode="numeric" disabled={!canManage} onChange={(v) => form.patch({ pingRoleId: v })} />
        <TextField label={ts("guildId")} help={ts("guildIdHelp")} value={draft.guildId} maxLength={25} inputMode="numeric" disabled={!canManage} onChange={(v) => form.patch({ guildId: v })} />
        <Field>
          <FieldLabel htmlFor={`${zonesId}-input`}>{ts("timeZone")}</FieldLabel>
          <Input id={`${zonesId}-input`} list={zonesId} value={draft.timeZone} maxLength={64} disabled={!canManage} onChange={(e) => form.patch({ timeZone: e.target.value })} />
          <datalist id={zonesId}>
            {timeZones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <FieldDescription>{ts("timeZoneHelp")}</FieldDescription>
        </Field>
        <TextField label={ts("rulebookUrl")} help={ts("rulebookUrlHelp")} value={draft.rulebookUrl} maxLength={2000} disabled={!canManage} onChange={(v) => form.patch({ rulebookUrl: v })} />
      </FieldGroup>
    </SectionCard>
  );
}
