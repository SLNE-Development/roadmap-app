import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SettingsMembersView } from "./members-view";

/** Project members and their roles; owners add, change and remove them. */
export default async function SettingsMembersPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(
    trpc.account.me.queryOptions(),
    trpc.account.users.queryOptions(),
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.members.list.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <SettingsMembersView slug={slug} />
    </HydrateClient>
  );
}
