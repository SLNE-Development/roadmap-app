import { Ban, CircleHelp, Lock, Scale } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** What kind of thing needs attention; sets the icon, its colours and the kind label. */
export type AttentionKind = "blocked" | "planning" | "decision" | "question";

/** One row of the "Needs attention" panel. */
export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  href: string;
}

/** Icon, soft square colours and label of each attention kind. */
const KINDS: Record<AttentionKind, { icon: typeof Ban; className: string; label: string }> = {
  blocked: { icon: Ban, className: "bg-cat-blocked-soft text-cat-blocked", label: "Blocked" },
  planning: { icon: Lock, className: "bg-cat-planning-soft text-cat-planning", label: "Planning" },
  decision: { icon: Scale, className: "bg-cat-review-soft text-cat-review", label: "Decision" },
  question: { icon: CircleHelp, className: "bg-cat-todo-soft text-cat-todo", label: "Question" },
};

/** Rows of things that need someone: a soft-coloured square icon, a title, a detail line and the kind. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((a) => {
        const kind = KINDS[a.kind];
        const Icon = kind.icon;
        return (
          <li key={a.key}>
            <Link
              href={a.href}
              className="flex items-start gap-3.5 border-t px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-5"
            >
              <span aria-hidden className={cn("flex size-[30px] shrink-0 items-center justify-center", kind.className)}>
                <Icon className="size-[15px]" strokeWidth={2.2} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="font-semibold">{a.title}</span>
                <span className="line-clamp-2 text-[13px] leading-[1.45] text-fg-2">{a.detail}</span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{kind.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
