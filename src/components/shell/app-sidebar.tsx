"use client";

import { Activity, BookOpen, Bot, ChevronsUpDown, CircleHelp, KanbanSquare, LayoutGrid, List, Map as MapIcon, Rocket, Scale, Search, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRoleLabel } from "@/components/chips";
import { NotificationBell } from "@/components/notifications/bell";
import { ProjectMark } from "@/components/person-avatar";
import { cn } from "@/lib/utils";
import { openCommandMenu } from "./command-menu";
import { SidebarViews, type SidebarView } from "./sidebar-views";
import { UserArea } from "./user-area";

/** The signed-in user as the sidebar shows them. */
export interface SidebarActor {
  name: string;
  isAdmin: boolean;
}

/** The current project with what its navigation shows. */
export interface SidebarProject {
  slug: string;
  name: string;
  role: string;
  memberCount: number;
  boards: { slug: string; name: string; count: number }[];
  counts: { systems: number; adrs: number; pages: number; openQuestions: number; releases: number; liveRuns: number };
}

/** A project in the switcher. */
export interface SidebarProjectLink {
  slug: string;
  name: string;
}

/** Shared look of a sidebar row; the active one sits on the surface with a hairline. */
function rowClass(active: boolean) {
  return cn(
    "flex items-center gap-2.5 px-2.5 py-[7px] text-[13.5px] transition-colors",
    active ? "bg-sidebar-accent font-semibold text-foreground ring-1 ring-sidebar-border" : "font-medium text-fg-2 hover:bg-sidebar-accent/60 hover:text-foreground",
  );
}

/** A count on the right of a sidebar row. */
function Count({ value }: { value: number }) {
  return <span className="bg-secondary px-[7px] py-px text-[11px] font-semibold text-fg-2">{value}</span>;
}

/**
 * The persistent left navigation: logo, project switcher, search and the notification bell, the project's
 * sections (or the project list outside a project), settings and the account area.
 */
export function AppSidebar({
  actor,
  projects,
  project,
  views = [],
}: {
  actor: SidebarActor;
  projects: SidebarProjectLink[];
  project?: SidebarProject;
  views?: SidebarView[];
}) {
  const t = useTranslations("shell");
  const roleLabel = useRoleLabel();
  const pathname = usePathname();
  const base = project ? `/p/${project.slug}` : "";
  const is = (path: string, exact = false) => (exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`));

  const sections = project
    ? [
        { href: base, label: t("sectionOverview"), icon: LayoutGrid, active: is(base, true) },
        { href: `${base}/boards`, label: t("sectionBoards"), icon: KanbanSquare, active: is(`${base}/boards`), boards: project.boards },
        { href: `${base}/systems`, label: t("sectionSystems"), icon: List, active: is(`${base}/systems`), count: project.counts.systems },
        { href: `${base}/roadmap`, label: t("sectionRoadmap"), icon: MapIcon, active: is(`${base}/roadmap`) },
        { href: `${base}/releases`, label: t("sectionReleases"), icon: Rocket, active: is(`${base}/releases`), count: project.counts.releases },
        { href: `${base}/adrs`, label: t("sectionDecisions"), icon: Scale, active: is(`${base}/adrs`), count: project.counts.adrs },
        { href: `${base}/pages`, label: t("sectionPages"), icon: BookOpen, active: is(`${base}/pages`), count: project.counts.pages },
        { href: `${base}/questions`, label: t("sectionQuestions"), icon: CircleHelp, active: is(`${base}/questions`), count: project.counts.openQuestions },
        { href: `${base}/activity`, label: t("sectionActivity"), icon: Activity, active: is(`${base}/activity`) },
        { href: `${base}/agents`, label: t("sectionAgents"), icon: Bot, active: is(`${base}/agents`), count: project.counts.liveRuns },
      ]
    : [];
  const others = projects.filter((p) => p.slug !== project?.slug);

  return (
    <nav aria-label={t("mainNavigation")} className="flex h-full w-full flex-col gap-[18px] bg-sidebar px-3 py-4 text-sidebar-foreground">
      <Link href="/" className="flex shrink-0 items-center gap-2.5 px-2 py-1">
        <span className="flex size-[26px] items-center justify-center bg-primary text-primary-foreground">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
            <path d="M2 9c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
          </svg>
        </span>
        <span className="font-display text-lg font-bold tracking-[-0.01em]">Roadmap</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex shrink-0 items-center gap-2.5 border bg-card p-2 text-left outline-none hover:bg-card/70 focus-visible:ring-2 focus-visible:ring-ring">
          {project ? <ProjectMark name={project.name} slug={project.slug} /> : <span className="size-6 border border-dashed" aria-hidden />}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold">{project ? project.name : t("allProjects")}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {project ? t("roleAndMembers", { role: roleLabel(project.role), count: project.memberCount }) : t("projectCount", { count: projects.length })}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>{t("switchProject")}</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem key={p.slug} asChild>
              <Link href={`/p/${p.slug}`} className="gap-2.5">
                <ProjectMark name={p.name} slug={p.slug} size="sm" />
                {p.name}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/">{t("allProjects")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex shrink-0 items-stretch gap-1.5">
        <button
          type="button"
          onClick={openCommandMenu}
          className="flex min-w-0 flex-1 items-center gap-2 border bg-background px-2.5 py-[7px] text-[13px] text-muted-foreground hover:text-foreground"
        >
          <Search className="size-[15px]" aria-hidden />
          <span className="flex-1 truncate text-left">{t("searchOrJump")}</span>
          <kbd className="border bg-card px-[5px] py-px font-mono text-[11px]">⌘K</kbd>
        </button>
        <NotificationBell className="w-[34px] border bg-background text-muted-foreground hover:text-foreground" />
      </div>

      {/* Only the navigation between search and settings scrolls; the top and bottom stay put. */}
      <div className="-mx-3 flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto overscroll-contain px-3">
      {project ? (
        <div className="flex flex-col gap-0.5">
          {sections.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <Link href={s.boards?.[0] ? `${base}/boards/${s.boards[0].slug}` : s.href} aria-current={s.active ? "page" : undefined} className={rowClass(s.active)}>
                <s.icon className="size-4 opacity-90" aria-hidden />
                <span className="flex-1">{s.label}</span>
                {s.count !== undefined && s.count > 0 && <Count value={s.count} />}
              </Link>
              {s.boards && s.boards.length > 0 && (
                <div className="ml-[17px] flex flex-col gap-px border-l pl-3">
                  {s.boards.map((b) => {
                    const active = is(`${base}/boards/${b.slug}`);
                    return (
                      <Link
                        key={b.slug}
                        href={`${base}/boards/${b.slug}`}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex justify-between px-2.5 py-[5px] text-[13px]",
                          active ? "bg-brand-soft font-semibold text-brand-strong" : "font-medium text-fg-2 hover:text-foreground",
                        )}
                      >
                        <span className="truncate">{b.name}</span>
                        <span className="text-xs text-muted-foreground">{b.count}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={rowClass(pathname === "/")}>
            <LayoutGrid className="size-4 opacity-90" aria-hidden />
            <span className="flex-1">{t("projects")}</span>
            <Count value={projects.length} />
          </Link>
          <Link href="/workload" aria-current={is("/workload") ? "page" : undefined} className={rowClass(is("/workload"))}>
            <Users className="size-4 opacity-90" aria-hidden />
            <span className="flex-1">{t("workload")}</span>
          </Link>
        </div>
      )}

      <SidebarViews views={views} />

      {others.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{project ? t("otherProjects") : t("yourProjects")}</div>
          {others.slice(0, project ? 4 : 12).map((p) => (
            <Link key={p.slug} href={`/p/${p.slug}`} className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-fg-2 hover:text-foreground">
              <ProjectMark name={p.name} slug={p.slug} size="sm" />
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
        </div>
      )}

      </div>
      <div className="flex shrink-0 flex-col gap-1.5 border-t pt-3">
        {project && (
          <Link href={`${base}/settings`} aria-current={is(`${base}/settings`) ? "page" : undefined} className={rowClass(is(`${base}/settings`))}>
            <SlidersHorizontal className="size-4" aria-hidden />
            {t("projectSettings")}
          </Link>
        )}
        <UserArea name={actor.name} isAdmin={actor.isAdmin} />
      </div>
    </nav>
  );
}
