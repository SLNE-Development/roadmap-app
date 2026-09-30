import { Badge } from "@/components/ui/badge";
import type { ColumnCategory, Priority, TaskState } from "@/db/schema";
import { cn } from "@/lib/utils";

/** Background class of each column category's colour dot (literal strings so Tailwind keeps them). */
export const CATEGORY_CLASS: Record<ColumnCategory, string> = {
  planning: "bg-cat-planning",
  todo: "bg-cat-todo",
  active: "bg-cat-active",
  review: "bg-cat-review",
  blocked: "bg-cat-blocked",
  done: "bg-cat-done",
};

/** A small round dot in a category's colour. */
export function CategoryDot({ category, className }: { category: ColumnCategory; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", CATEGORY_CLASS[category], className)} />;
}

/** A badge naming a column with its category colour. */
export function CategoryBadge({ category, name }: { category: ColumnCategory; name: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <CategoryDot category={category} />
      {name}
    </Badge>
  );
}

/** A badge showing a priority; MVP is emphasised. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={priority === "MVP" ? "default" : "secondary"}>{priority}</Badge>;
}

/** A badge showing an owner, or "Unowned". */
export function OwnerBadge({ name }: { name: string | null }) {
  return <Badge variant="outline">{name ?? "Unowned"}</Badge>;
}

/** Category colour used for each task state. */
const STATE_CATEGORY: Record<TaskState, ColumnCategory> = { todo: "todo", doing: "active", blocked: "blocked", done: "done" };

/** A badge showing a task state with its colour. */
export function TaskStateBadge({ state }: { state: TaskState }) {
  return <CategoryBadge category={STATE_CATEGORY[state]} name={state} />;
}
