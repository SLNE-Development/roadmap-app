import { redirect } from "next/navigation";

/** Members moved into the project settings; keeps old links working. */
export default async function MembersPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  redirect(`/p/${slug}/settings/members`);
}
