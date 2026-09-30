import { HistoryList } from "@/components/history-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { listActivity } from "@/lib/ops/activity";
import { pageData, toIso } from "@/lib/page";

/** The project's change log, newest first. */
export default async function ActivityPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const entries = await pageData((db, actor) => listActivity(db, actor, slug, { limit: 300 }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Activity" title="Recent changes" />
      <Card>
        <CardContent>
          <HistoryList entries={entries.map(toIso)} showEntity />
        </CardContent>
      </Card>
    </div>
  );
}
