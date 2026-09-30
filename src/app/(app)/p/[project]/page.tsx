import { CircleCheck, GitBranch, Milestone, Newspaper } from "lucide-react";
import Link from "next/link";
import { AgentTag, CATEGORY_CLASS, CATEGORY_LABEL } from "@/components/chips";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { AttentionList, type AttentionItem } from "@/components/overview/attention-list";
import { EmptyState, Page, PageHeader, Panel, ProgressBar } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import type { ColumnCategory } from "@/db/schema";
import { listActivity } from "@/lib/ops/activity";
import { formatAdrNumber, listAdrs } from "@/lib/ops/adrs";
import { planningGaps } from "@/lib/ops/planning";
import { getProject } from "@/lib/ops/projects";
import { listQuestions } from "@/lib/ops/questions";
import { listPhases } from "@/lib/ops/structure";
import { listSystems } from "@/lib/ops/systems";
import { latestUpdates, listUpdates } from "@/lib/ops/updates";
import { pageData } from "@/lib/page";
import { relativeAge } from "@/lib/time";

/** Order of the status bar's segments and legend. */
const SEGMENTS: ColumnCategory[] = ["done", "review", "active", "todo", "blocked", "planning"];

/** Open questions older than this need attention. */
const QUESTION_AGE_MS = 3 * 86_400_000;

/** Whether an open question was asked more than {@link QUESTION_AGE_MS} ago. */
function isStale(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > QUESTION_AGE_MS;
}

/** Joins words as "a", "a and b" or "a, b and c". */
function joinAnd(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Turns planning gaps into one human sentence ("Scope and risks have no answer yet; 2 items are still open."). */
function planningDetail(gaps: string[]): string {
  const areas = gaps.flatMap((g) => /^Area (.+) has no answered item\.$/.exec(g)?.[1] ?? []);
  const open = gaps.filter((g) => g.startsWith("Item ")).length;
  const parts: string[] = [];
  if (areas.length) parts.push(`${joinAnd(areas)} ${areas.length === 1 ? "has" : "have"} no answer yet`);
  if (open) parts.push(`${open} ${open === 1 ? "item is" : "items are"} still open`);
  if (gaps.some((g) => g.startsWith("No spec"))) parts.push("no spec is written");
  if (parts.length === 0) return "Everything is answered; planning can be completed.";
  const text = parts.join("; ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/** Returns a repository URL without its scheme and host, for display ("org/repo"). */
function repoLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "") || parsed.host;
  } catch {
    return url;
  }
}

/**
 * Project overview: status of all systems by category, what needs attention,
 * progress per phase and the latest progress updates.
 */
export default async function OverviewPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    const [systems, phases, adrs, questions, updates, latest, activity] = await Promise.all([
      listSystems(db, actor, slug),
      listPhases(db, actor, slug),
      listAdrs(db, actor, slug, { status: "proposed" }),
      listQuestions(db, actor, slug, { resolved: false }),
      listUpdates(db, actor, slug, { limit: 8 }),
      latestUpdates(db, detail.project.id),
      listActivity(db, actor, slug, { limit: 1 }),
    ]);
    const planning = systems.filter((s) => s.columnCategory === "planning");
    const gaps = await Promise.all(planning.map((s) => planningGaps(db, s.id)));
    const staleQuestions = questions.filter((q) => isStale(q.createdAt));
    return { detail, systems, phases, adrs, staleQuestions, updates, latest, activity, planning, gaps };
  });
  const { project } = data.detail;
  const canEdit = data.detail.role !== "viewer";
  const tasksDone = data.systems.reduce((n, s) => n + s.tasksDone, 0);
  const tasksTotal = data.systems.reduce((n, s) => n + s.tasksTotal, 0);
  const counts = SEGMENTS.map((c) => ({ category: c, n: data.systems.filter((s) => s.columnCategory === c).length }));
  const lastChange = [data.activity[0]?.createdAt, data.updates[0]?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const base = `/p/${slug}`;

  const attention: AttentionItem[] = [
    ...data.systems
      .filter((s) => s.columnCategory === "blocked")
      .map((s): AttentionItem => {
        const latest = data.latest.get(s.id);
        return {
          key: `blocked-${s.id}`,
          kind: "blocked",
          title: `${s.title} is blocked`,
          detail: latest ? `${latest.summary} · ${relativeAge(latest.createdAt.toISOString())}` : "No update explains why yet.",
          href: `${base}/systems/${s.slug}`,
        };
      }),
    ...data.planning.map(
      (s, i): AttentionItem => ({
        key: `planning-${s.id}`,
        kind: "planning",
        title: `${s.title} is still in planning`,
        detail: planningDetail(data.gaps[i]),
        href: `${base}/systems/${s.slug}?tab=planning`,
      }),
    ),
    ...data.adrs.map(
      (a): AttentionItem => ({
        key: `adr-${a.number}`,
        kind: "decision",
        title: `ADR-${formatAdrNumber(a.number)} is waiting for acceptance`,
        detail: a.title,
        href: `${base}/adrs/${a.number}`,
      }),
    ),
    ...data.staleQuestions.map(
      (q): AttentionItem => ({
        key: `question-${q.id}`,
        kind: "question",
        title: q.title,
        detail: `Asked by ${q.author} ${relativeAge(q.createdAt.toISOString())}${q.answer ? ", answered but not resolved." : ", no answer yet."}`,
        href: `${base}/questions`,
      }),
    ),
  ];

  const newSystem = canEdit && data.detail.boards.length > 0 && (
    <NewSystemDialog projectSlug={slug} boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name }))} />
  );

  return (
    <Page>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        actions={
          (project.repoUrl || newSystem) && (
            <>
              {project.repoUrl && (
                <Button variant="outline" asChild className="text-[13px] font-normal text-fg-2">
                  <a href={project.repoUrl} target="_blank" rel="noreferrer noopener">
                    <GitBranch aria-hidden className="size-3.5" />
                    {repoLabel(project.repoUrl)}
                  </a>
                </Button>
              )}
              {newSystem}
            </>
          )
        }
      />

      <section aria-label="Systems by status" className="flex flex-col gap-3 border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-[15px] font-semibold">
            {data.systems.length} {data.systems.length === 1 ? "system" : "systems"}
          </h2>
          <span className="text-[13px] text-muted-foreground">
            {tasksDone} of {tasksTotal} tasks done
            {lastChange && ` · last change ${relativeAge(lastChange.toISOString())}`}
          </span>
        </div>
        <div className="flex h-2.5 gap-[3px]" aria-hidden>
          {data.systems.length === 0 ? (
            <span className="flex-1 bg-track" />
          ) : (
            counts.filter((c) => c.n > 0).map((c) => <span key={c.category} className={CATEGORY_CLASS[c.category]} style={{ flexGrow: c.n }} />)
          )}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {counts.map((c) => (
            <li key={c.category} className="flex items-center gap-[7px] text-[13px] text-fg-2">
              <span aria-hidden className={`size-2 rounded-full ${CATEGORY_CLASS[c.category]}`} />
              {CATEGORY_LABEL[c.category]} <b className="font-semibold text-foreground">{c.n}</b>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Needs attention" meta={attention.length > 0 && `${attention.length} ${attention.length === 1 ? "item" : "items"}`}>
            {attention.length > 0 ? (
              <AttentionList items={attention} />
            ) : (
              <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                <EmptyState
                  icon={<CircleCheck />}
                  title="Nothing needs attention"
                  description="No blocked systems, open planning, pending decisions or stale questions."
                />
              </div>
            )}
          </Panel>

          <Panel
            title="Phases"
            action={
              <Link href={`${base}/roadmap`} className="text-[13px] font-medium text-brand-strong hover:underline">
                Open roadmap
              </Link>
            }
            bodyClassName="px-4 pb-3 sm:px-5"
          >
            {data.phases.length === 0 ? (
              <EmptyState
                icon={<Milestone />}
                title="No phases yet"
                description="Phases order the work into milestones."
                className="mb-2"
                action={
                  canEdit && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`${base}/settings/structure`}>Add phases</Link>
                    </Button>
                  )
                }
              />
            ) : (
              <ol className="flex flex-col">
                {data.phases.map((p, i) => {
                  const items = data.systems.filter((s) => s.phaseId === p.id);
                  const done = items.filter((s) => s.columnCategory === "done").length;
                  const complete = items.length > 0 && done === items.length;
                  return (
                    <li key={p.id} className="grid grid-cols-[22px_minmax(0,150px)_minmax(0,1fr)_48px] items-center gap-3 py-[7px]">
                      <span className="font-mono text-[11.5px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate font-medium">{p.name}</span>
                      <ProgressBar value={done} total={items.length} colorClass={complete ? "bg-cat-done" : "bg-primary"} className="h-1.5 min-w-0" />
                      <span className="text-right font-mono text-[12.5px] text-fg-2">
                        {done}/{items.length}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>

        <Panel
          title="Latest updates"
          action={
            <Link href={`${base}/activity`} className="text-[13px] font-medium text-brand-strong hover:underline">
              All activity
            </Link>
          }
        >
          {data.updates.length === 0 ? (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <EmptyState icon={<Newspaper />} title="No updates yet" description="Progress updates from people and agents show up here." />
            </div>
          ) : (
            <ol className="flex flex-col">
              {data.updates.map((u) => {
                const { authorName: name, agent } = u;
                return (
                  <li key={u.id}>
                    <article className="flex gap-3 border-t px-4 py-3 sm:px-5">
                      <PersonAvatar name={name} size="md" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted-foreground">
                          <span className="font-semibold text-foreground">{name}</span>
                          {agent && <AgentTag agent={agent} />}
                          <span>on</span>
                          <Link href={`${base}/systems/${u.systemSlug}`} className="font-medium text-fg-2 hover:text-foreground hover:underline">
                            {u.systemTitle}
                          </Link>
                          <time className="ml-auto whitespace-nowrap" dateTime={u.createdAt.toISOString()}>
                            {relativeAge(u.createdAt.toISOString())}
                          </time>
                        </div>
                        <p className="line-clamp-3 text-[13.5px] leading-normal break-words">{u.summary}</p>
                        {u.commitHash &&
                          (u.commitUrl ? (
                            <a
                              href={u.commitUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="self-start font-mono text-[11.5px] text-brand-strong hover:underline"
                            >
                              {u.commitHash.slice(0, 7)}
                            </a>
                          ) : (
                            <span className="self-start font-mono text-[11.5px] text-muted-foreground">{u.commitHash.slice(0, 7)}</span>
                          ))}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
    </Page>
  );
}
