"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useShortDate } from "@/components/account/short-date";
import { useNow } from "@/components/clock";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/** The `?error=` values the OAuth callback comes back with, each with a message under `account.connections.errors`. */
const KNOWN_ERRORS = ["state", "taken", "github"] as const;

/** Returns whether `error` is one of the {@link KNOWN_ERRORS}. */
function isKnownError(error: string): error is (typeof KNOWN_ERRORS)[number] {
  return (KNOWN_ERRORS as readonly string[]).includes(error);
}

/**
 * The connections page body: the linked GitHub login with an unlink button, or a button that starts linking.
 *
 * @param props.linked whether the callback just linked an account
 * @param props.error the callback's `?error=` value
 */
export function ConnectionsView({ linked, error }: { linked: boolean; error: string | undefined }) {
  const t = useTranslations("account.connections");
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = useNow();
  const shortDate = useShortDate(now);
  const { data } = useSuspenseQuery(trpc.github.account.queryOptions());
  const start = useMutation(trpc.github.startLink.mutationOptions());
  const unlink = useMutation(
    trpc.github.unlinkAccount.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.github.account.queryKey() });
        toast.success(t("unlinked"));
      },
    }),
  );
  const onError = (err: { message: string }) => toast.error(err.message);

  useEffect(() => {
    if (!linked && !error) return;
    if (linked) toast.success(t("linked"), { id: "github-link" });
    else if (error) toast.error(isKnownError(error) ? t(`errors.${error}`) : t("errors.other"), { id: "github-link" });
    router.replace("/settings/connections", { scroll: false });
  }, [linked, error, router, t]);

  const account = data.account;
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb") }]}
        title={t("title")}
        description={t("description")}
      />
      <Panel title="GitHub">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          {account ? (
            <>
              <span className="flex min-w-0 flex-col">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <GitBranch className="size-4 text-fg-2" aria-hidden />
                  <span className="truncate">{account.login}</span>
                </span>
                <span className="text-[12.5px] text-fg-2">{t("linkedOn", { date: shortDate(account.linkedAt) })}</span>
              </span>
              <Button variant="outline" size="sm" disabled={unlink.isPending} onClick={() => unlink.mutate(undefined, { onError })}>
                {t("unlink")}
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-fg-2">{data.configured ? t("noneLinked") : t("notConfigured")}</span>
              <Button
                size="sm"
                disabled={!data.configured || start.isPending}
                onClick={() => start.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url), onError })}
              >
                {t("connect")}
              </Button>
            </>
          )}
        </div>
      </Panel>
    </Page>
  );
}
