import { Bot } from "lucide-react";
import type { AdrStatus, ColumnCategory, Priority, TaskState } from "@/db/schema";
import { cn } from "@/lib/utils";

/*
 * Tide chips: one shape per meaning. Status uses the six category colours;
 * priority, roles, agents and ADR states each have their own treatment.
 */

/** Background class of each column category's colour (literal strings so Tailwind keeps them). */
export const CATEGORY_CLASS: Record<ColumnCategory, string> = {
  planning: "bg-cat-planning",
  todo: "bg-cat-todo",
  active: "bg-cat-active",
  review: "bg-cat-review",
  blocked: "bg-cat-blocked",
  done: "bg-cat-done",
};

/** Text class of each column category's colour. */
export const CATEGORY_TEXT: Record<ColumnCategory, string> = {
  planning: "text-cat-planning",
  todo: "text-cat-todo",
  active: "text-cat-active",
  review: "text-cat-review",
  blocked: "text-cat-blocked",
  done: "text-cat-done",
};

/** Soft background plus text class of each category, for chips. */
const CATEGORY_CHIP: Record<ColumnCategory, string> = {
  planning: "bg-cat-planning-soft text-cat-planning",
  todo: "bg-cat-todo-soft text-cat-todo",
  active: "bg-cat-active-soft text-cat-active",
  review: "bg-cat-review-soft text-cat-review",
  blocked: "bg-cat-blocked-soft text-cat-blocked",
  done: "bg-cat-done-soft text-cat-done",
};

/** Display names of the categories, for filters and editors. */
export const CATEGORY_LABEL: Record<ColumnCategory, string> = {
  planning: "Planning",
  todo: "Todo",
  active: "In progress",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

/** Category colour used for each task state. */
export const STATE_CATEGORY: Record<TaskState, ColumnCategory> = { todo: "todo", doing: "active", blocked: "blocked", done: "done" };

/** Display names of task states. */
export const STATE_LABEL: Record<TaskState, string> = { todo: "Todo", doing: "Doing", blocked: "Blocked", done: "Done" };

/** A small round dot in a category's colour. */
export function CategoryDot({ category, className }: { category: ColumnCategory; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", CATEGORY_CLASS[category], className)} />;
}

/** A status chip: soft category background, dot and the column's name. */
export function StatusChip({ category, name, className }: { category: ColumnCategory; name: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] w-fit items-center gap-1.5 pr-2 pl-[7px] text-xs font-semibold whitespace-nowrap", CATEGORY_CHIP[category], className)}>
      <CategoryDot category={category} className="size-[7px]" />
      {name}
    </span>
  );
}

/** Priority: MVP is a filled Tide tag, Later is outlined, Nice to have is plain text. */
export function PriorityTag({ priority, className }: { priority: Priority; className?: string }) {
  const style =
    priority === "MVP"
      ? "bg-brand-soft px-1.5 py-0.5 font-bold tracking-[0.02em] text-brand-strong"
      : priority === "Later"
        ? "border border-border px-1.5 py-px font-semibold text-fg-2"
        : "font-medium text-muted-foreground";
  return <span className={cn("inline-block w-fit text-[10.5px] leading-4 whitespace-nowrap", style, className)}>{priority}</span>;
}

/** The name of the agent that made a change, in mono on a sunken tag. */
export function AgentTag({ agent, className }: { agent: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 bg-secondary px-1.5 font-mono text-[11px] leading-[18px] text-fg-2", className)}>
      <Bot aria-hidden className="size-3" />
      {agent}
    </span>
  );
}

/** A neutral tag, used for roles and plain labels. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-block bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-fg-2", className)}>{children}</span>;
}

/** Display names of project roles. */
export const ROLE_LABEL: Record<string, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer", admin: "Admin" };

/** A project role as a neutral tag. */
export function RoleTag({ role }: { role: string }) {
  return <Tag>{ROLE_LABEL[role] ?? role}</Tag>;
}

/** An ADR status: accepted green, proposed amber, superseded muted and struck through. */
export function AdrStatusChip({ status }: { status: AdrStatus }) {
  const style = {
    accepted: "bg-cat-done-soft text-cat-done font-semibold",
    proposed: "bg-cat-review-soft text-cat-review font-semibold",
    superseded: "bg-secondary text-muted-foreground font-medium line-through",
  }[status];
  return <span className={cn("inline-block px-2 py-0.5 text-xs whitespace-nowrap capitalize", style)}>{status}</span>;
}
