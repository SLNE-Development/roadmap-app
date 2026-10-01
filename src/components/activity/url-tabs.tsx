import Link from "next/link";
import { cn } from "@/lib/utils";

/** One link-driven tab: its label, optional count, target and whether it is shown. */
export interface UrlTab {
  label: string;
  count?: number;
  href: string;
  active: boolean;
}

/**
 * Underlined tabs that switch by URL (`?status=`, `?tab=`), with counts. The
 * row's bottom border runs under `children`, which sit on the right.
 */
export function UnderlineTabs({ label, tabs, children }: { label: string; tabs: UrlTab[]; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b">
      <nav aria-label={label} className="-mb-px flex flex-1 gap-5 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 border-b-2 pb-2.5 text-sm whitespace-nowrap outline-none focus-visible:text-foreground focus-visible:underline",
              t.active ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-fg-2 hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="text-xs font-medium text-muted-foreground">{t.count}</span>}
          </Link>
        ))}
      </nav>
      {children && <div className="mb-2 flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** A segmented control of links (`?kind=`), the current one raised on the sunken track, with optional counts. */
export function SegmentedLinks({ label, items }: { label: string; items: UrlTab[] }) {
  return (
    <nav aria-label={label} className="flex w-fit bg-secondary p-[3px]">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "flex h-[26px] items-center px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            t.active ? "bg-card font-semibold text-foreground" : "font-medium text-fg-2 hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Builds `path` with the current query `params` changed by `patch`; `null`
 * or empty values remove the parameter.
 */
export function withQuery(path: string, params: Record<string, string | undefined>, patch: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
