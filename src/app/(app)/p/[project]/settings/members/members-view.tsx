"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { MemberManager } from "@/components/member-manager";
import { useTRPC } from "@/trpc/client";

/**
 * The Members settings page body: the members with their roles and the
 * allowlisted users who can be added.
 *
 * @param props.slug the project slug
 */
export function SettingsMembersView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: me }, { data: users }, { data: detail }, { data: members }] = useSuspenseQueries({
    queries: [
      trpc.account.me.queryOptions(),
      trpc.account.users.queryOptions({ project: slug }),
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.members.list.queryOptions({ project: slug }),
    ],
  });
  return (
    <MemberManager
      projectSlug={slug}
      members={members.map(({ joinedAt, ...m }) => ({ ...m, joinedAt: joinedAt.toISOString() }))}
      users={users}
      currentUserId={me.userId}
      canOwn={detail.role === "owner" || detail.role === "admin"}
    />
  );
}
