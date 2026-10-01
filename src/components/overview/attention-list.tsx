"use client";

import { Ban, CircleHelp, Hourglass, ListX, Lock, Scale } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { AttentionItem, AttentionKind } from "@/lib/ops/attention";
import { useRelativeTime } from "@/lib/use-relative-time";
import { cn } from "@/lib/utils";

/** Icon and soft square colours of each attention kind; the label is `overview.attention.kind.<kind>`. */
const KINDS: Record<AttentionKind, { icon: typeof Ban; className: string }> = {
  blocked: { icon: Ban, className: "bg-cat-blocked-soft text-cat-blocked" },
  "blocked-task": { icon: ListX, className: "bg-cat-blocked-soft text-cat-blocked" },
  stale: { icon: Hourglass, className: "bg-cat-review-soft text-cat-review" },
  planning: { icon: Lock, className: "bg-cat-planning-soft text-cat-planning" },
  decision: { icon: Scale, className: "bg-cat-review-soft text-cat-review" },
  question: { icon: CircleHelp, className: "bg-cat-todo-soft text-cat-todo" },
};

/** The `enums.planningArea` keys of the stored planning area slugs. */
const AREA_KEYS = { "failure-modes": "failureModes", dependencies: "dependencies", scope: "scope", "ops-testing": "opsTesting" } as const;

/** Returns writers of an item's title and detail line in the reader's language, from its `params`. */
function useAttentionText() {
  const t = useTranslations("overview.attention");
  const te = useTranslations("enums.planningArea");
  const format = useFormatter();
  const locale = useLocale();
  const title = (a: AttentionItem): string => {
    const p = a.params;
    switch (p.kind) {
      case "blocked":
        return t("title.blocked", { system: p.system });
      case "blocked-task":
        return t("title.blockedTask", { id: p.id });
      case "stale":
        return t("title.stale", { system: p.system, days: p.days });
      case "planning":
        return t("title.planning", { system: p.system });
      case "decision":
        return t("title.decision", { number: p.number });
      case "question":
        return a.title;
    }
  };
  const detail = (a: AttentionItem): string => {
    const p = a.params;
    switch (p.kind) {
      case "blocked":
        return p.summary ?? t("detail.blockedNone");
      case "blocked-task":
        return t("detail.blockedTask", { system: p.system, reason: p.reason ?? t("detail.noReason") });
      case "stale":
        return t("detail.stale");
      case "planning": {
        const areas = p.areas.map((slug) => (slug in AREA_KEYS ? te(AREA_KEYS[slug as keyof typeof AREA_KEYS]) : slug));
        const parts = [
          ...(areas.length ? [t("detail.areasNoAnswer", { count: areas.length, areas: format.list(areas, { type: "conjunction" }) })] : []),
          ...(p.open ? [t("detail.itemsOpen", { count: p.open })] : []),
          ...(p.noSpec ? [t("detail.noSpec")] : []),
        ];
        if (parts.length === 0) return t("detail.allAnswered");
        const sentence = parts.join("; ");
        return `${sentence.charAt(0).toLocaleUpperCase(locale)}${sentence.slice(1)}.`;
      }
      case "decision":
        return a.detail;
      case "question": {
        const text = t("detail.question", { author: p.author, answered: p.answered ? "yes" : "no" });
        return p.blocking ? t("detail.questionBlocking", { text }) : text;
      }
    }
  };
  return { title, detail };
}

/** Rows of things that need someone: a soft-coloured square icon, a title, a detail line and the kind. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const t = useTranslations("overview.attention.kind");
  const text = useAttentionText();
  const relative = useRelativeTime();
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
                <span className="font-semibold">{text.title(a)}</span>
                <span className="line-clamp-2 text-[13px] leading-[1.45] text-fg-2">{a.at ? `${text.detail(a)} · ${relative(a.at)}` : text.detail(a)}</span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{t(a.kind)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
