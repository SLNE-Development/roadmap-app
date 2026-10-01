import Link from "next/link";
import { TaskStateChip } from "@/components/chips";
import { PersonAvatar } from "@/components/person-avatar";
import type { TaskItem } from "@/lib/ops/systems";

/** One task with its state and owner, linking to its row on the overview. */
function StepRow({ task, href }: { task: TaskItem; href: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 border-t px-4 py-2 text-[13px] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="w-6 shrink-0 font-mono text-[11.5px] text-muted-foreground">{task.planStep !== null ? `#${task.planStep}` : ""}</span>
        <span className="min-w-0 flex-1">{task.title}</span>
        <TaskStateChip state={task.state} />
        {task.ownerName && (
          <span title={task.ownerName}>
            <PersonAvatar name={task.ownerName} size="xs" />
            <span className="sr-only">{task.ownerName}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * The tasks of a system by plan step, with how many are done. Tasks that are
 * not part of the plan are listed after them.
 *
 * @param props.viewingVersion the plan version on screen when it is not the latest; tasks follow the latest plan
 */
export function PlanStepsPanel({
  tasks,
  projectSlug,
  systemSlug,
  viewingVersion,
}: {
  tasks: TaskItem[];
  projectSlug: string;
  systemSlug: string;
  viewingVersion?: number;
}) {
  const href = (t: TaskItem) => `/p/${projectSlug}/systems/${systemSlug}?tab=overview#task-${t.id}`;
  const steps = tasks.filter((t) => t.planStep !== null).sort((a, b) => (a.planStep as number) - (b.planStep as number));
  const loose = tasks.filter((t) => t.planStep === null);
  const done = steps.filter((t) => t.state === "done").length;
  return (
    <section aria-label="Plan steps" className="flex flex-col border bg-card">
      <header className="flex items-baseline justify-between gap-2 px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold">Steps</h2>
        <span className="text-[12.5px] text-muted-foreground">
          {done} of {steps.length} done
        </span>
      </header>
      {viewingVersion !== undefined && (
        <p className="px-4 pb-2.5 text-[12.5px] text-cat-review">Task state is live; you are viewing plan v{viewingVersion}</p>
      )}
      {steps.length > 0 ? (
        <ul>
          {steps.map((t) => (
            <StepRow key={t.id} task={t} href={href(t)} />
          ))}
        </ul>
      ) : (
        <p className="border-t px-4 py-3 text-[13px] text-fg-2">No task is linked to a plan step yet.</p>
      )}
      {loose.length > 0 && (
        <>
          <p className="border-t px-4 pt-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Not in the plan</p>
          <p className="px-4 pb-2 text-[12.5px] text-muted-foreground">Added by hand, so no plan step shows their state.</p>
          <ul>
            {loose.map((t) => (
              <StepRow key={t.id} task={t} href={href(t)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
