"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Heading } from "@/lib/headings";
import { cn } from "@/lib/utils";

/** Fewer headings than this make an outline pointless. */
export const MIN_OUTLINE_HEADINGS = 3;

/** The id of the heading currently near the top of the viewport, tracked while the page scrolls. */
function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("\n");
  useEffect(() => {
    const elements = key
      .split("\n")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Only entries that crossed the band at the top; the last one in document order wins.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActive(visible[visible.length - 1].target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [key]);
  return active;
}

/** The linked list of headings, shared by the sticky column and the disclosure. */
function OutlineList({ headings, active }: { headings: Heading[]; active: string | null }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {headings.map((h) => (
        <li key={h.id} className={cn(h.depth === 3 && "pl-3")}>
          <a
            href={`#${h.id}`}
            aria-current={active === h.id ? "location" : undefined}
            className={cn("block text-muted-foreground hover:text-foreground", active === h.id && "text-foreground font-medium")}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The contents of a document: a sticky column from `lg` up, a collapsible
 * disclosure above the document below it. The heading in view is highlighted.
 * Renders nothing for documents with fewer than three headings.
 */
export function DocumentOutline({ headings }: { headings: Heading[] }) {
  const t = useTranslations("documents.outline");
  const active = useActiveHeading(headings.map((h) => h.id));
  if (headings.length < MIN_OUTLINE_HEADINGS) return null;
  return (
    <nav aria-label={t("contents")}>
      <Collapsible className="lg:hidden">
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-[13px] font-semibold">
          {t("contents")}
          <ChevronDown aria-hidden className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <OutlineList headings={headings} active={active} />
        </CollapsibleContent>
      </Collapsible>
      <div className="sticky top-4 hidden max-h-[calc(100vh-2rem)] overflow-y-auto lg:block">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{t("contents")}</p>
        <OutlineList headings={headings} active={active} />
      </div>
    </nav>
  );
}
