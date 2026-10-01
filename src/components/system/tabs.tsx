import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** The sections of the system page, in tab order. */
export const SYSTEM_TABS = ["overview", "spec", "plan", "planning", "activity"] as const;

/** A section of the system page. */
export type SystemTab = (typeof SYSTEM_TABS)[number];

/** Returns the page's section from the `tab` search parameter, defaulting to the overview. */
export function parseTab(value: string | string[] | undefined): SystemTab {
  return SYSTEM_TABS.find((t) => t === value) ?? "overview";
}

/** Returns the URL of a section of the system at `base`. */
export function tabHref(base: string, tab: SystemTab): string {
  return tab === "overview" ? base : `${base}?tab=${tab}`;
}

/** Returns the URL of a spec or plan tab comparing version `from` with version `to`. */
export function compareHref(base: string, tab: "spec" | "plan", from: number, to: number): string {
  return `${base}?tab=${tab}&compare=${from}..${to}`;
}

/**
 * The section tabs as links: an underline row with a version or count after
 * each label from 1024px, a horizontally scrollable row of square pills below.
 *
 * @param props.meta the text after each label, such as "v2" or "14"
 */
export function SystemTabs({ base, current, meta }: { base: string; current: SystemTab; meta: Partial<Record<SystemTab, string>> }) {
  const t = useTranslations("system.tabs");
  return (
    <>
      <nav aria-label={t("sections")} className="hidden gap-[22px] border-b lg:flex">
        {SYSTEM_TABS.map((tab) => (
          <Link
            key={tab}
            href={tabHref(base, tab)}
            aria-current={tab === current ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm outline-none focus-visible:text-foreground focus-visible:underline",
              tab === current ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-fg-2 hover:text-foreground",
            )}
          >
            {t(tab)}
            {meta[tab] && <span className="text-xs font-medium text-muted-foreground">{meta[tab]}</span>}
          </Link>
        ))}
      </nav>
      <nav aria-label={t("sections")} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden">
        {SYSTEM_TABS.map((tab) => (
          <Link
            key={tab}
            href={tabHref(base, tab)}
            aria-current={tab === current ? "page" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 border px-3.5 text-[13.5px]",
              tab === current ? "border-foreground bg-foreground font-semibold text-background" : "bg-card font-medium text-fg-2",
            )}
          >
            {t(tab)}
          </Link>
        ))}
      </nav>
    </>
  );
}
