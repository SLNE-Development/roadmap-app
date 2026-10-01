import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Content widths: boards and tables use the full width, most pages 1120px, reading pages 760px. */
const WIDTHS = { full: "", wide: "max-w-[1120px]", medium: "max-w-[1000px]", narrow: "max-w-[880px]", reading: "max-w-[760px]" };

/** The content column of a page, centred at one of three widths. */
export function Page({ width = "wide", className, children }: { width?: keyof typeof WIDTHS; className?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-9 lg:py-8">
      <div className={cn("mx-auto flex w-full flex-col gap-6", WIDTHS[width], className)}>{children}</div>
    </div>
  );
}

/** A breadcrumb step; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The one page header: breadcrumbs (or a context line), the title in the
 * display face, an optional description, and actions on the right.
 */
export function PageHeader({
  crumbs,
  title,
  description,
  actions,
  children,
}: {
  crumbs?: Crumb[];
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useTranslations("shell");
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {crumbs && crumbs.length > 0 && (
            <nav aria-label={t("breadcrumb")} className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>/</span>}
                  {c.href ? (
                    <Link href={c.href} className="hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-fg-2">
                      {c.label}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          )}
          <h1 className="font-display text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance">{title}</h1>
          {description && <div className="max-w-[720px] text-sm leading-normal text-fg-2">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** A bordered surface for a group of content, with an optional header row. */
export function Panel({
  title,
  meta,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col border bg-card text-card-foreground", className)}>
      {(title || meta || action) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 pb-3 sm:px-5">
          {title && <h2 className="font-display text-[19px] font-semibold">{title}</h2>}
          {meta && <span className="text-[12.5px] text-muted-foreground">{meta}</span>}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn("flex flex-col", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A dashed box saying what is missing and, optionally, how to add it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 border border-dashed px-4 py-8 text-center", className)}>
      {icon && <span className="flex size-9 items-center justify-center bg-secondary text-fg-2 [&_svg]:size-[18px]">{icon}</span>}
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-sm text-[12.5px] leading-normal text-fg-2">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A thin square progress bar; `colorClass` sets the fill (a `bg-*` class). */
export function ProgressBar({ value, total, colorClass = "bg-primary", className }: { value: number; total: number; colorClass?: string; className?: string }) {
  const pct = total > 0 ? Math.round((100 * value) / total) : 0;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      className={cn("flex h-1 min-w-10 flex-1 overflow-hidden bg-track", className)}
    >
      <span className={cn("h-full", colorClass)} style={{ width: `${pct}%` }} />
    </span>
  );
}
