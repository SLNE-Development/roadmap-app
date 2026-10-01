import { cn } from "@/lib/utils";

/** A mentioned member in rendered text: a square pill reading `@Name`, not a link. */
export function MentionChip({ name, userId, className }: { name: string; userId: string; className?: string }) {
  return (
    <span data-mention={userId} className={cn("bg-brand-soft px-1 py-px font-semibold text-brand-strong", className)}>
      @{name}
    </span>
  );
}
