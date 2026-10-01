"use client";

import { useMutation } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { SecretField } from "@/components/events/secret-field";
import { SectionCard } from "@/components/events/settings/section-card";
import { FieldGroup } from "@/components/ui/field";
import type { EventSettingsView } from "@/lib/ops/event-settings";
import { useTRPC } from "@/trpc/client";

/**
 * Webhooks and bot. Everyone sees whether each secret is set with its last four characters; only admins can set,
 * replace or clear them. Each secret saves on its own through `setSecrets`, the page never holds a secret.
 */
export function SecretsSection({ settings, isAdmin }: { settings: EventSettingsView; isAdmin: boolean }) {
  const ts = useTranslations("events.settings");
  const format = useFormatter();
  const trpc = useTRPC();
  const saveSecrets = useMutation(trpc.requests.settings.setSecrets.mutationOptions({ onSuccess: () => toast.success(ts("secretsSaved")) }));
  const secret = (key: "publicWebhook" | "teamWebhook" | "staffWebhook" | "botToken") => (value: string | null) => saveSecrets.mutateAsync({ [key]: value });
  return (
    <SectionCard id="webhooks" title={ts("secretsTitle")} help={isAdmin ? ts("secretsAdmin") : ts("secretsManager")}>
      <FieldGroup>
        <SecretField label={ts("publicWebhook")} help={ts("publicWebhookHelp")} state={settings.secrets.publicWebhook} editable={isAdmin} pending={saveSecrets.isPending} onSave={secret("publicWebhook")} />
        <SecretField label={ts("teamWebhook")} help={ts("teamWebhookHelp")} state={settings.secrets.teamWebhook} editable={isAdmin} pending={saveSecrets.isPending} onSave={secret("teamWebhook")} />
        <SecretField label={ts("staffWebhook")} help={ts("staffWebhookHelp")} state={settings.secrets.staffWebhook} editable={isAdmin} pending={saveSecrets.isPending} onSave={secret("staffWebhook")} />
        <SecretField label={ts("botToken")} help={ts("botTokenHelp")} state={settings.secrets.botToken} editable={isAdmin} pending={saveSecrets.isPending} onSave={secret("botToken")} />
        {settings.secrets.botToken.set && (
          <p role="status" className="text-[13px] text-fg-2">
            {settings.botStatus
              ? ts("botStatus", { status: ts(`botStatusValue.${settings.botStatus}`), date: settings.botCheckedAt ? format.dateTime(settings.botCheckedAt, { dateStyle: "medium", timeStyle: "short" }) : "" })
              : ts("botStatusUnknown")}
          </p>
        )}
      </FieldGroup>
    </SectionCard>
  );
}
