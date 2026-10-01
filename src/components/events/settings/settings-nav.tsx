"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** The sections of the page, in order; each is a card with the same id. */
export const SECTIONS = ["posting", "webhooks", "style", "details", "disaster", "resolved", "cancelled"] as const;

/** One of {@link SECTIONS}. */
export type SectionId = (typeof SECTIONS)[number];

/**
 * The section navigation of the event settings: anchors to the cards, a vertical list beside the content on wide
 * screens and a horizontal row above it on phones, like the project settings navigation. The active item follows the
 * card nearest the top of the page while scrolling, and the one just clicked.
 */
export function SettingsSectionNav() {
  const t = useTranslations("events.settings.nav");
  const [active, setActive] = useState<SectionId>("posting");
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = SECTIONS.find((s) => visible.has(s));
        if (first) setActive(first);
      },
      { rootMargin: "-15% 0px -65% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <nav aria-label={t("label")} className="-mx-4 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-0.5 md:flex-col">
        {SECTIONS.map((s) => (
          <li key={s} className="shrink-0">
            <a
              href={`#${s}`}
              aria-current={active === s ? "location" : undefined}
              onClick={() => setActive(s)}
              className={cn(
                "flex items-center px-3 py-2 text-[13.5px] font-medium whitespace-nowrap text-fg-2 transition-colors hover:bg-muted hover:text-foreground md:whitespace-normal",
                active === s && "bg-brand-soft font-semibold text-brand-strong hover:bg-brand-soft hover:text-brand-strong",
              )}
            >
              {t(s)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
