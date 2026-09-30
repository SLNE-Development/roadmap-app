import { redirect } from "next/navigation";

/** The old updates feed, now part of Activity. */
export default async function UpdatesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  redirect(`/p/${slug}/activity?kind=updates`);
}
