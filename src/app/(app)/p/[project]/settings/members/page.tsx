import { MemberManager } from "@/components/member-manager";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { listUsers } from "@/lib/ops/users";
import { pageData } from "@/lib/page";

/** Project members and their roles; owners add, change and remove them. */
export default async function SettingsMembersPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => {
    const [detail, members, users] = await Promise.all([getProject(db, actor, slug), listMembers(db, actor, slug), listUsers(db)]);
    return { role: detail.role, members: members.map(({ joinedAt, ...m }) => ({ ...m, joinedAt: joinedAt.toISOString() })), users, userId: actor.userId };
  });
  return (
    <MemberManager
      projectSlug={slug}
      members={data.members}
      users={data.users}
      currentUserId={data.userId}
      canOwn={data.role === "owner" || data.role === "admin"}
    />
  );
}
