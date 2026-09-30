import Link from "next/link";
import { CategoryBadge } from "@/components/chips";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { listPhases } from "@/lib/ops/structure";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";
import { categoryProgress } from "@/lib/progress";

/** Phase roadmap: each phase with its goal, dependencies, progress and systems. */
export default async function RoadmapPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { phases, systems } = await pageData(async (db, actor) => ({
    phases: await listPhases(db, actor, slug),
    systems: await listSystems(db, actor, slug),
  }));
  const name = new Map(phases.map((p) => [p.id, p.name]));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Roadmap" title="Delivery phases" />
      {phases.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No phases yet</EmptyTitle>
            <EmptyDescription>Add phases in Settings, or let an agent create them with create_phase.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ol className="flex flex-col gap-3">
        {phases.map((p) => {
          const items = systems.filter((s) => s.phaseId === p.id);
          const progress = categoryProgress(items);
          return (
            <li key={p.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                    {p.name}
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                      {items.filter((s) => s.columnCategory === "done").length}/{items.length} done · {progress}%
                    </span>
                  </CardTitle>
                  {p.goal && <CardDescription>{p.goal}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Progress value={progress} aria-label={`${p.name} progress`} />
                  {p.dependsOn.length > 0 && (
                    <p className="text-xs text-muted-foreground">Builds on: {p.dependsOn.map((d) => name.get(d) ?? d).join(", ")}</p>
                  )}
                  <ul className="flex flex-wrap gap-2">
                    {items.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/p/${slug}/systems/${s.slug}`}
                          className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm hover:border-primary"
                        >
                          {s.title}
                          <CategoryBadge category={s.columnCategory} name={s.columnName} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
