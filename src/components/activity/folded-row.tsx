import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { AgentTag } from "@/components/chips";
import { PersonAvatar } from "@/components/person-avatar";
import { cn } from "@/lib/utils";
import type { FoldedGroup } from "./fold";

/** What a fold did: "made 12 changes to search-index" or "made 12 changes across 3 systems". */
function summary(t: ReturnType<typeof useTranslations<"activity.timeline">>, group: FoldedGroup): string {
  const count = group.items.length;
  if (group.systemTitles.length === 0) return t("foldChanges", { count });
  if (group.systemTitles.length === 1) return t("foldChangesTo", { count, system: group.systemTitles[0] });
  return t("foldChangesAcross", { count, systems: group.systemTitles.length });
}

/**
 * A folded burst of changes: avatar, author, what happened and the UTC time
 * range in the user's time zone, with a toggle that reveals the original rows (`children`) indented.
 */
export function FoldedRow({ group, children }: { group: FoldedGroup; children: ReactNode }) {
  const t = useTranslations("activity.timeline");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });
  return (
    <li className="border-b last:border-b-0">
      <div className="flex gap-3 px-4 py-3">
        <PersonAvatar name={group.authorName} size="md" />
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13.5px] leading-[1.45]">
          <span className="font-semibold">{group.authorName}</span>
          {group.agent && <AgentTag agent={group.agent} className="self-center" />}
          <span className="text-fg-2">{summary(t, group)}</span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-0.5 self-center text-xs text-brand-strong hover:underline"
          >
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            {open ? t("hideChanges") : t("showChanges")}
          </button>
        </p>
        <time dateTime={group.to} className="text-xs whitespace-nowrap text-muted-foreground">
          {time(group.from)}–{time(group.to)}
        </time>
      </div>
      {open && <ol className="ml-10 border-t border-l">{children}</ol>}
    </li>
  );
}
