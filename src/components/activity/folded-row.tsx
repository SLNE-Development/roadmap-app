import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AgentTag } from "@/components/chips";
import { PersonAvatar } from "@/components/person-avatar";
import { plural } from "@/lib/text";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { FoldedGroup } from "./fold";

/** What a fold did: "made 12 changes to search-index" or "made 12 changes across 3 systems". */
function summary(group: FoldedGroup): string {
  const changes = `made ${group.items.length} changes`;
  if (group.systemTitles.length === 0) return changes;
  if (group.systemTitles.length === 1) return `${changes} to ${group.systemTitles[0]}`;
  return `${changes} across ${plural(group.systemTitles.length, "system")}`;
}

/**
 * A folded burst of changes: avatar, author, what happened and the UTC time
 * range, with a toggle that reveals the original rows (`children`) indented.
 */
export function FoldedRow({ group, children }: { group: FoldedGroup; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b last:border-b-0">
      <div className="flex gap-3 px-4 py-3">
        <PersonAvatar name={group.authorName} size="md" />
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13.5px] leading-[1.45]">
          <span className="font-semibold">{group.authorName}</span>
          {group.agent && <AgentTag agent={group.agent} className="self-center" />}
          <span className="text-fg-2">{summary(group)}</span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-0.5 self-center text-xs text-brand-strong hover:underline"
          >
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            {open ? "Hide changes" : "Show changes"}
          </button>
        </p>
        <time dateTime={group.to} className="text-xs whitespace-nowrap text-muted-foreground">
          {formatTime(group.from)}–{formatTime(group.to)}
          <span className="text-muted-foreground/70"> UTC</span>
        </time>
      </div>
      {open && <ol className="ml-10 border-t border-l">{children}</ol>}
    </li>
  );
}
