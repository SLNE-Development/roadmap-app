"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { AllowlistManager } from "@/components/allowlist-manager";
import { Page, PageHeader } from "@/components/page";
import { useTRPC } from "@/trpc/client";

/** The accounts page body: the allowlist with admin toggles, removal and the form adding an account. */
export function AdminUsersView() {
  const trpc = useTRPC();
  const [{ data: me }, { data: accounts }] = useSuspenseQueries({
    queries: [trpc.account.me.queryOptions(), trpc.account.accounts.queryOptions()],
  });
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Admin" }]}
        title="Accounts"
        description="Only Discord accounts on this list can sign in. Admins see and manage every project."
      />
      <AllowlistManager accounts={accounts} selfId={me.userId} />
    </Page>
  );
}
