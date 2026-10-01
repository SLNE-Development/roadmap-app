"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * The project settings sub-navigation: a vertical list beside the content on
 * wide screens, a horizontal row above it on phones. The active item follows the URL.
 * Notifications shows only to owners.
 */
export function SettingsNav({
  projectSlug,
  memberCount,
  boardCount,
  repoCount,
  fieldCount,
  canOwn,
}: {
  projectSlug: string;
  memberCount: number;
  boardCount: number;
  /** Linked repositories, or null while loading. */
  repoCount: number | null;
  fieldCount: number;
  canOwn: boolean;
}) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const base = `/p/${projectSlug}/settings`;
  const items = [
    { href: base, label: t("nav.general"), count: null },
    { href: `${base}/members`, label: t("nav.members"), count: memberCount },
    { href: `${base}/structure`, label: t("nav.structure"), count: null },
    { href: `${base}/glossary`, label: t("nav.glossary"), count: null },
    { href: `${base}/boards`, label: t("nav.boards"), count: boardCount },
    { href: `${base}/github`, label: t("nav.github"), count: repoCount },
    { href: `${base}/fields`, label: t("nav.fields"), count: fieldCount },
    ...(canOwn ? [{ href: `${base}/notifications`, label: t("nav.notifications"), count: null }] : []),
  ];
  return (
    <nav aria-label={t("nav.label")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-0.5 md:flex-col">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2 text-[13.5px] font-medium text-fg-2 transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-brand-soft font-semibold text-brand-strong hover:bg-brand-soft hover:text-brand-strong",
                )}
              >
                <span>{item.label}</span>
                {item.count !== null && <span className="font-medium text-muted-foreground tabular-nums">{item.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
