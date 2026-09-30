import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemListItem } from "@/lib/ops/systems";
import { relativeAge } from "@/lib/time";
import { CategoryBadge, OwnerBadge, PriorityBadge } from "./chips";

/** A catalogue card for one system with its column, priority, owner, tasks and latest update. */
export function SystemCard({
  system,
  latest,
  projectSlug,
}: {
  system: SystemListItem;
  latest?: { summary: string; createdAt: string };
  projectSlug: string;
}) {
  return (
    <Link href={`/p/${projectSlug}/systems/${system.slug}`} className="block h-full">
      <Card className="h-full transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-2">
            {system.title}
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{system.boardName}</span>
          </CardTitle>
          {system.summary && <CardDescription className="line-clamp-3">{system.summary}</CardDescription>}
        </CardHeader>
        <CardContent className="mt-auto flex flex-col gap-2">
          {latest && (
            <p className="line-clamp-2 border-l-2 border-primary pl-2 text-xs text-muted-foreground">
              {relativeAge(latest.createdAt)}: {latest.summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <CategoryBadge category={system.columnCategory} name={system.columnName} />
            <PriorityBadge priority={system.priority} />
            <OwnerBadge name={system.ownerName} />
            {!system.planningComplete && <Badge variant="outline">planning open</Badge>}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {system.tasksDone}/{system.tasksTotal} tasks
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
