import { notFound } from "next/navigation";
import { AllowlistManager } from "@/components/allowlist-manager";
import { Page, PageHeader } from "@/components/page";
import { listAllowedAccounts } from "@/lib/ops/users";
import { pageData } from "@/lib/page";

/** Admin page listing provisioned Discord accounts; non-admins get a 404. */
export default async function AdminUsersPage() {
  const { accounts, selfId } = await pageData(async (db, actor) => {
    if (!actor.isAdmin) notFound();
    return { accounts: await listAllowedAccounts(db, actor), selfId: actor.userId };
  });
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Admin" }]}
        title="Accounts"
        description="Only Discord accounts on this list can sign in. Admins see and manage every project."
      />
      <AllowlistManager accounts={accounts} selfId={selfId} />
    </Page>
  );
}
