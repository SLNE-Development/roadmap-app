import { notFound } from "next/navigation";
import { AllowlistManager } from "@/components/allowlist-manager";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { listAllowedAccounts } from "@/lib/ops/users";

/** Admin page listing provisioned Discord accounts; non-admins get a 404. */
export default async function AdminUsersPage() {
  const actor = await requireActor();
  if (!actor.isAdmin) notFound();
  const accounts = await listAllowedAccounts(getDb(), actor);
  return (
    <div className="mx-auto max-w-7xl py-6">
      <div className="flex max-w-5xl flex-col gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Admin</p>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Only these Discord accounts can sign in. Find an id in Discord with Developer Mode on: right-click the user, Copy User ID.
          </p>
        </div>
        <AllowlistManager accounts={accounts} selfId={actor.userId} />
      </div>
    </div>
  );
}
