"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { Page, PageHeader } from "@/components/page";
import { PostingSection } from "@/components/events/settings/posting-section";
import { SecretsSection } from "@/components/events/settings/secrets-section";
import { SettingsSectionNav } from "@/components/events/settings/settings-nav";
import { StyleSection } from "@/components/events/settings/style-section";
import { DetailsTemplateSection, EmbedTemplateSection } from "@/components/events/settings/template-section";
import { useTRPC } from "@/trpc/client";

/**
 * The event settings page: a section navigation beside one card per section (posting, webhooks and bot, writing style
 * and the four message templates with live Discord previews). Event managers and admins edit; developers read. Each
 * section saves on its own with its own unsaved-changes bar, and only admins can change the secrets.
 */
export function EventSettingsView() {
  const t = useTranslations("events");
  const ts = useTranslations("events.settings");
  const format = useFormatter();
  const trpc = useTRPC();
  const [{ data: settings }, { data: me }] = useSuspenseQueries({ queries: [trpc.requests.settings.get.queryOptions(), trpc.account.me.queryOptions()] });
  const canManage = me.isAdmin || me.isEventManager;

  return (
    <Page width="wide">
      <PageHeader
        crumbs={[{ label: t("crumb"), href: "/requests" }, { label: ts("crumb") }]}
        title={ts("title")}
        description={
          <>
            {canManage ? ts("description") : ts("readOnly")} <span className="text-muted-foreground">{ts("updatedAt", { date: format.dateTime(settings.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
          </>
        }
      />
      <div className="grid items-start gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <SettingsSectionNav />
        <div className="flex min-w-0 flex-col gap-6">
          <PostingSection settings={settings} canManage={canManage} />
          <SecretsSection settings={settings} isAdmin={me.isAdmin} />
          <StyleSection settings={settings} canManage={canManage} />
          <DetailsTemplateSection settings={settings} canManage={canManage} />
          <EmbedTemplateSection kind="disaster" settings={settings} canManage={canManage} />
          <EmbedTemplateSection kind="resolved" settings={settings} canManage={canManage} />
          <EmbedTemplateSection kind="cancelled" settings={settings} canManage={canManage} />
        </div>
      </div>
    </Page>
  );
}
