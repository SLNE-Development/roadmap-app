import { MemberManager } from "@/components/member-manager";
import { PageHeader } from "@/components/page-header";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { listUsers } from "@/lib/ops/users";
import { pageData } from "@/lib/page";

/** Project members and their roles. */
export default async function MembersPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => ({
    role: (await getProject(db, actor, slug)).role,
    members: await listMembers(db, actor, slug),
    users: await listUsers(db),
  }));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader eyebrow="Members" title="Who works on this project" description="Viewers read, editors change content, owners also manage members, boards and settings." />
      <MemberManager
        projectSlug={slug}
        members={data.members}
        users={data.users}
        canOwn={data.role === "owner" || data.role === "admin"}
      />
    </div>
  );
}
