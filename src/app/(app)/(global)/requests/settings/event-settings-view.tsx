"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { EmbedTemplateEditor } from "@/components/events/embed-template-editor";
import { SecretField } from "@/components/events/secret-field";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_STYLE_GUIDES, type DetailsTemplate, type EmbedTemplate } from "@/lib/event-templates";
import type { EventSettingsView as SettingsView } from "@/lib/ops/event-settings";
import { useTRPC } from "@/trpc/client";

/** The fields the managed form edits; empty text stands for "not set" where the column is nullable. */
interface Form {
  postAs: string;
  pingRoleId: string;
  guildId: string;
  timeZone: string;
  rulebookUrl: string;
  announcementStyle: string;
  announcementExample: string;
  reminderExample: string;
  teamStyle: string;
  teamExample: string;
  disasterTemplate: EmbedTemplate;
  resolvedTemplate: EmbedTemplate;
  detailsTemplate: DetailsTemplate;
}

/** The form's start values from the saved settings. */
function formOf(s: SettingsView): Form {
  return {
    postAs: s.postAs,
    pingRoleId: s.pingRoleId ?? "",
    guildId: s.guildId ?? "",
    timeZone: s.timeZone,
    rulebookUrl: s.rulebookUrl ?? "",
    announcementStyle: s.announcementStyle,
    announcementExample: s.announcementExample,
    reminderExample: s.reminderExample,
    teamStyle: s.teamStyle,
    teamExample: s.teamExample,
    disasterTemplate: s.disasterTemplate,
    resolvedTemplate: s.resolvedTemplate,
    detailsTemplate: s.detailsTemplate,
  };
}

/** A text field of the managed form. */
function TextField({ label, help, value, onChange, disabled, maxLength, inputMode }: { label: string; help?: string; value: string; onChange: (v: string) => void; disabled: boolean; maxLength: number; inputMode?: "numeric" }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} maxLength={maxLength} inputMode={inputMode} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  );
}

/** A long text field of the managed form; `placeholder` shows the default that applies while it is empty. */
function AreaField({ label, help, value, onChange, disabled, placeholder }: { label: string; help?: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} rows={4} value={value} maxLength={20_000} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  );
}

/**
 * The event settings page. Event managers and admins edit the managed fields and templates in one form; developers read.
 * The webhooks and the bot token are separate: everyone sees whether each is set with its last four characters, and
 * only admins can set, replace or clear them. The secret controls post to `setSecrets` alone, the form never holds a
 * secret.
 */
export function EventSettingsView() {
  const t = useTranslations("events");
  const ts = useTranslations("events.settings");
  const format = useFormatter();
  const trpc = useTRPC();
  const timeZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zonesId = useId();
  const [{ data: settings }, { data: me }] = useSuspenseQueries({ queries: [trpc.requests.settings.get.queryOptions(), trpc.account.me.queryOptions()] });
  const canManage = me.isAdmin || me.isEventManager;
  const [form, setForm] = useState<Form>(() => formOf(settings));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation(trpc.requests.settings.update.mutationOptions({ onSuccess: () => toast.success(ts("saved")) }));
  const saveSecrets = useMutation(trpc.requests.settings.setSecrets.mutationOptions({ onSuccess: () => toast.success(ts("secretsSaved")) }));
  const secret = (key: "publicWebhook" | "teamWebhook" | "staffWebhook" | "botToken") => (value: string | null) => saveSecrets.mutateAsync({ [key]: value });

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb"), href: "/requests" }, { label: ts("crumb") }]}
        title={ts("title")}
        description={canManage ? ts("description") : ts("readOnly")}
      />
      <Panel title={ts("secretsTitle")} bodyClassName="gap-5 px-4 pb-4 sm:px-5">
        <p className="text-[13px] text-fg-2">{me.isAdmin ? ts("secretsAdmin") : ts("secretsManager")}</p>
        <FieldGroup>
          <SecretField label={ts("publicWebhook")} help={ts("publicWebhookHelp")} state={settings.secrets.publicWebhook} editable={me.isAdmin} pending={saveSecrets.isPending} onSave={secret("publicWebhook")} />
          <SecretField label={ts("teamWebhook")} help={ts("teamWebhookHelp")} state={settings.secrets.teamWebhook} editable={me.isAdmin} pending={saveSecrets.isPending} onSave={secret("teamWebhook")} />
          <SecretField label={ts("staffWebhook")} help={ts("staffWebhookHelp")} state={settings.secrets.staffWebhook} editable={me.isAdmin} pending={saveSecrets.isPending} onSave={secret("staffWebhook")} />
          <SecretField label={ts("botToken")} help={ts("botTokenHelp")} state={settings.secrets.botToken} editable={me.isAdmin} pending={saveSecrets.isPending} onSave={secret("botToken")} />
        </FieldGroup>
      </Panel>
      <form
        className="flex flex-col gap-6"
        aria-label={ts("formLabel")}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            ...form,
            pingRoleId: form.pingRoleId.trim() || null,
            guildId: form.guildId.trim() || null,
            rulebookUrl: form.rulebookUrl.trim() || null,
          });
        }}
      >
        <Panel title={ts("channelsTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <FieldGroup>
            <TextField label={ts("postAs")} help={ts("postAsHelp")} value={form.postAs} maxLength={80} disabled={!canManage} onChange={(v) => set("postAs", v)} />
            <TextField label={ts("pingRoleId")} help={ts("pingRoleIdHelp")} value={form.pingRoleId} maxLength={21} inputMode="numeric" disabled={!canManage} onChange={(v) => set("pingRoleId", v)} />
            <TextField label={ts("guildId")} help={ts("guildIdHelp")} value={form.guildId} maxLength={25} inputMode="numeric" disabled={!canManage} onChange={(v) => set("guildId", v)} />
            <Field>
              <FieldLabel htmlFor={`${zonesId}-input`}>{ts("timeZone")}</FieldLabel>
              <Input id={`${zonesId}-input`} list={zonesId} value={form.timeZone} maxLength={64} disabled={!canManage} onChange={(e) => set("timeZone", e.target.value)} />
              <datalist id={zonesId}>
                {timeZones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              <FieldDescription>{ts("timeZoneHelp")}</FieldDescription>
            </Field>
          </FieldGroup>
        </Panel>
        <Panel title={ts("rulebookTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <TextField label={ts("rulebookUrl")} help={ts("rulebookUrlHelp")} value={form.rulebookUrl} maxLength={2000} disabled={!canManage} onChange={(v) => set("rulebookUrl", v)} />
        </Panel>
        <Panel title={ts("announcementTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <FieldGroup>
            <AreaField label={ts("announcementStyle")} help={ts("styleHelp")} value={form.announcementStyle} placeholder={DEFAULT_STYLE_GUIDES.announcement} disabled={!canManage} onChange={(v) => set("announcementStyle", v)} />
            <AreaField label={ts("announcementExample")} value={form.announcementExample} disabled={!canManage} onChange={(v) => set("announcementExample", v)} />
            <AreaField label={ts("reminderExample")} value={form.reminderExample} disabled={!canManage} onChange={(v) => set("reminderExample", v)} />
          </FieldGroup>
        </Panel>
        <Panel title={ts("teamTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <FieldGroup>
            <AreaField label={ts("teamStyle")} help={ts("styleHelp")} value={form.teamStyle} placeholder={DEFAULT_STYLE_GUIDES.team} disabled={!canManage} onChange={(v) => set("teamStyle", v)} />
            <AreaField label={ts("teamExample")} value={form.teamExample} disabled={!canManage} onChange={(v) => set("teamExample", v)} />
          </FieldGroup>
        </Panel>
        <Panel title={ts("disasterTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <EmbedTemplateEditor kind="disaster" value={form.disasterTemplate} disabled={!canManage} onChange={(v) => set("disasterTemplate", v)} />
        </Panel>
        <Panel title={ts("resolvedTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <EmbedTemplateEditor kind="resolved" value={form.resolvedTemplate} disabled={!canManage} onChange={(v) => set("resolvedTemplate", v)} />
        </Panel>
        <Panel title={ts("detailsTitle")} bodyClassName="gap-4 px-4 pb-4 sm:px-5">
          <EmbedTemplateEditor kind="details" value={form.detailsTemplate} disabled={!canManage} onChange={(v) => set("detailsTemplate", v)} />
        </Panel>
        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              {ts("save")}
            </Button>
            <span className="text-xs text-muted-foreground">{ts("updatedAt", { date: format.dateTime(settings.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
          </div>
        )}
      </form>
    </Page>
  );
}
