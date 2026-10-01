"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { AtSign, Bell, CircleHelp, History, ListChecks, Lock, Scale } from "lucide-react";
import Link from "next/link";
import { useNow } from "@/components/clock";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { MyWorkItem } from "@/lib/ops/my-work";
import { relativeAge } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** Icon and soft square colours of each kind; kinds added later fall back to a bell. */
const KINDS: Record<string, { icon: typeof Bell; className: string }> = {
  task: { icon: ListChecks, className: "bg-cat-active-soft text-cat-active" },
  planning: { icon: Lock, className: "bg-cat-planning-soft text-cat-planning" },
  question: { icon: CircleHelp, className: "bg-cat-todo-soft text-cat-todo" },
  decision: { icon: Scale, className: "bg-cat-review-soft text-cat-review" },
  mention: { icon: AtSign, className: "bg-brand-soft text-brand-strong" },
  change: { icon: History, className: "bg-secondary text-fg-2" },
};
const GENERIC = { icon: Bell, className: "bg-secondary text-fg-2" };

/** The line under a row's title: who did it (for changes), the detail and the age. */
function detailLine(item: MyWorkItem, now: Date): string {
  const who = item.authorName ? (item.agent ? `${item.agent} for ${item.authorName}` : item.authorName) : item.agent;
  const parts = [item.kind === "change" ? who : null, item.detail, relativeAge(item.at.toISOString(), now)];
  return parts.filter(Boolean).join(" · ");
}

/** Rows in the look of the attention list: a soft-coloured icon square, the title, and a detail line with the age. */
function Rows({ items }: { items: MyWorkItem[] }) {
  const now = useNow();
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const kind = KINDS[item.kind] ?? GENERIC;
        const Icon = kind.icon;
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              data-nav-item
              className="flex items-start gap-3.5 border-t px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-5"
            >
              <span aria-hidden className={cn("flex size-[30px] shrink-0 items-center justify-center", kind.className)}>
                <Icon className="size-[15px]" strokeWidth={2.2} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="font-semibold">{item.title}</span>
                <span className="line-clamp-2 text-[13px] leading-[1.45] text-fg-2">{detailLine(item, now)}</span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{item.projectName}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The My work inbox on the home page: what is waiting on the user, and what
 * changed on their systems since they last marked it seen. Renders nothing
 * when both lists are empty.
 */
export function MyWorkPanel() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.account.myWork.queryOptions());
  const markSeen = useMutation(trpc.account.markMyWorkSeen.mutationOptions());
  const waiting = data.items.filter((i) => i.section === "waiting");
  const changes = data.items.filter((i) => i.section === "changes");
  if (waiting.length === 0 && changes.length === 0) return null;
  return (
    <>
      {waiting.length > 0 && (
        <Panel title="Waiting on you" meta={String(waiting.length)}>
          <Rows items={waiting} />
        </Panel>
      )}
      {changes.length > 0 && (
        <Panel
          title="Since you were last here"
          meta={String(changes.length)}
          action={
            <Button size="sm" variant="outline" disabled={markSeen.isPending} onClick={() => markSeen.mutate()}>
              Mark all seen
            </Button>
          }
        >
          <Rows items={changes} />
        </Panel>
      )}
    </>
  );
}
