import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { UpdateItem } from "@/lib/ops/updates";
import { relativeAge } from "@/lib/time";
import { Markdown } from "./markdown";

/** A progress update with its timestamp as an ISO string. */
export type UpdateView = Omit<UpdateItem, "createdAt"> & { createdAt: string };

/**
 * Renders progress updates as a timeline, newest first.
 *
 * @param props.showSystem whether each entry links to its system (project feed)
 */
export function UpdateList({ updates, showSystem = false, projectSlug }: { updates: UpdateView[]; showSystem?: boolean; projectSlug: string }) {
  if (updates.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No progress updates yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {updates.map((u) => (
        <li key={u.id}>
          <Card size="sm">
            <CardContent className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{u.author}</span>
                {u.isAgent && <Badge variant="secondary">agent</Badge>}
                {showSystem && (
                  <Link href={`/p/${projectSlug}/systems/${u.systemSlug}`} className="text-primary hover:underline">
                    {u.systemTitle}
                  </Link>
                )}
                <time className="ml-auto font-mono text-xs text-muted-foreground" dateTime={u.createdAt} title={u.createdAt}>
                  {relativeAge(u.createdAt)}
                </time>
              </div>
              <Markdown className="text-sm">{u.summary}</Markdown>
              {u.nextStep && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">Next:</span> {u.nextStep}
                </p>
              )}
              {(u.taskTitle || u.commitHash) && (
                <div className="flex flex-wrap gap-2">
                  {u.taskTitle && <Badge variant="outline">Task: {u.taskTitle}</Badge>}
                  {u.commitHash &&
                    (u.commitUrl ? (
                      <Badge variant="outline" asChild>
                        <a href={u.commitUrl} target="_blank" rel="noreferrer noopener" className="font-mono">
                          {u.commitHash.slice(0, 7)}
                        </a>
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="font-mono">
                        {u.commitHash.slice(0, 7)}
                      </Badge>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}
