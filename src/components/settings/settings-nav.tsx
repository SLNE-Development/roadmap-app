"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The project settings sub-navigation: a vertical list beside the content on
 * wide screens, a horizontal row above it on phones. The active item follows the URL.
 */
export function SettingsNav({ projectSlug, memberCount, boardCount }: { projectSlug: string; memberCount: number; boardCount: number }) {
  const pathname = usePathname();
  const base = `/p/${projectSlug}/settings`;
  const items = [
    { href: base, label: "General", count: null },
    { href: `${base}/members`, label: "Members", count: memberCount },
    { href: `${base}/structure`, label: "Structure", count: null },
    { href: `${base}/boards`, label: "Boards", count: boardCount },
  ];
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
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
