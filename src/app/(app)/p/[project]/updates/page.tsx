import { PageHeader } from "@/components/page-header";
import { UpdateList } from "@/components/update-list";
import { listUpdates } from "@/lib/ops/updates";
import { pageData, toIso } from "@/lib/page";

/** Feed of every progress update in the project, newest first. */
export default async function UpdatesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const updates = await pageData((db, actor) => listUpdates(db, actor, slug, { limit: 200 }));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader eyebrow="Updates" title="What the project is up to" description="Progress posted by agents and people, newest first." />
      <UpdateList updates={updates.map(toIso)} showSystem projectSlug={slug} />
    </div>
  );
}
