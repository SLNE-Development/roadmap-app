"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** The message of each `?error=` the OAuth callback comes back with. */
const ERROR_MESSAGE: Record<string, string> = {
  state: "This GitHub sign-in expired or was started by someone else. Try connecting again.",
  taken: "That GitHub account is linked to another person.",
  github: "GitHub did not answer as expected. Try again in a moment.",
};

/**
 * The connections page body: the linked GitHub login with an unlink button, or a button that starts linking.
 *
 * @param props.linked whether the callback just linked an account
 * @param props.error the callback's `?error=` value
 */
export function ConnectionsView({ linked, error }: { linked: boolean; error: string | undefined }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = useNow();
  const { data } = useSuspenseQuery(trpc.github.account.queryOptions());
  const start = useMutation(trpc.github.startLink.mutationOptions());
  const unlink = useMutation(
    trpc.github.unlinkAccount.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.github.account.queryKey() });
        toast.success("GitHub unlinked");
      },
    }),
  );
  const onError = (err: { message: string }) => toast.error(err.message);

  useEffect(() => {
    if (!linked && !error) return;
    if (linked) toast.success("GitHub linked", { id: "github-link" });
    else if (error) toast.error(Object.hasOwn(ERROR_MESSAGE, error) ? ERROR_MESSAGE[error] : "Something went wrong with GitHub. Try again.", { id: "github-link" });
    router.replace("/settings/connections", { scroll: false });
  }, [linked, error, router]);

  const account = data.account;
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Account" }]}
        title="Connections"
        description="Linking your GitHub account attributes your pull requests and merges to you on the roadmap."
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
                <span className="text-[12.5px] text-fg-2">Linked {formatDate(account.linkedAt.toISOString(), now)}</span>
              </span>
              <Button variant="outline" size="sm" disabled={unlink.isPending} onClick={() => unlink.mutate(undefined, { onError })}>
                Unlink
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-fg-2">{data.configured ? "No GitHub account linked." : "The GitHub App is not set up yet."}</span>
              <Button
                size="sm"
                disabled={!data.configured || start.isPending}
                onClick={() => start.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url), onError })}
              >
                Connect GitHub
              </Button>
            </>
          )}
        </div>
      </Panel>
    </Page>
  );
}
