"use client";

import { Menu, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AppSidebar, type SidebarActor, type SidebarProject, type SidebarProjectLink } from "./app-sidebar";
import { CommandMenu, openCommandMenu } from "./command-menu";
import type { SidebarView } from "./sidebar-views";

/**
 * The signed-in frame: a sticky sidebar from 1024px up, and below that a top
 * bar whose menu button opens the same sidebar in a sheet. Also mounts ⌘K.
 */
export function AppShell({
  actor,
  projects,
  project,
  systems,
  views,
  children,
}: {
  actor: SidebarActor;
  projects: SidebarProjectLink[];
  project?: SidebarProject;
  systems?: { slug: string; title: string }[];
  views?: SidebarView[];
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const [menuPath, setMenuPath] = useState(pathname);
  // Close the mobile menu after navigating (adjusting state while rendering, not in an effect).
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  const sidebar = <AppSidebar actor={actor} projects={projects} project={project} views={views} />;
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-62 shrink-0 border-r lg:block">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-sidebar px-2 lg:hidden">
          <button type="button" aria-label="Open navigation" onClick={() => setMenuOpen(true)} className="flex size-11 items-center justify-center">
            <Menu className="size-5" />
          </button>
          <span className="min-w-0 flex-1 truncate font-display text-base font-semibold">{project?.name ?? "Roadmap"}</span>
          <button type="button" aria-label="Search" onClick={openCommandMenu} className="flex size-11 items-center justify-center">
            <Search className="size-[19px]" />
          </button>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <CommandMenu
        data={{
          isAdmin: actor.isAdmin,
          projects,
          project: project && { slug: project.slug, name: project.name, boards: project.boards },
          systems,
        }}
      />
    </div>
  );
}
