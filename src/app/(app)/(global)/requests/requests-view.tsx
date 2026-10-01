"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { NewRequestDialog } from "@/components/events/new-request-dialog";
import { RequestList } from "@/components/events/request-list";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/** The requests page: header with the settings link and "New request", then the grouped list. */
export function RequestsView() {
  const t = useTranslations("events");
  const trpc = useTRPC();
  const [{ data: rows }, { data: me }] = useSuspenseQueries({ queries: [trpc.requests.list.queryOptions({}), trpc.account.me.queryOptions()] });
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb") }]}
        title={t("list.title")}
        description={t("list.description")}
        actions={
          me.isAdmin || me.isEventManager || me.isEventDeveloper ? (
            <>
              <Button asChild variant="outline">
                <Link href="/requests/settings">{t("list.settings")}</Link>
              </Button>
              {me.isAdmin || me.isEventManager ? <NewRequestDialog /> : null}
            </>
          ) : undefined
        }
      />
      <RequestList rows={rows} userId={me.userId} />
    </Page>
  );
}
