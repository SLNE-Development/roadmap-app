import { notFound } from "next/navigation";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { AdminUsersView } from "./users-view";

/** Admin page listing provisioned Discord accounts; non-admins get a 404. */
export default async function AdminUsersPage() {
  const [me] = await prefetch(trpc.account.me.queryOptions());
  if (!me.isAdmin) notFound();
  await prefetch(trpc.account.accounts.queryOptions());
  return (
    <HydrateClient>
      <AdminUsersView />
    </HydrateClient>
  );
}
