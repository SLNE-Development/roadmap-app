"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Sections of a project, in navigation order. */
const SECTIONS = [
  { path: "", label: "Catalogue" },
  { path: "/boards", label: "Boards" },
  { path: "/roadmap", label: "Roadmap" },
  { path: "/adrs", label: "ADRs" },
  { path: "/questions", label: "Questions" },
  { path: "/updates", label: "Updates" },
  { path: "/members", label: "Members" },
  { path: "/activity", label: "Activity" },
  { path: "/settings", label: "Settings" },
];

/** Project switcher and section links; the current section is highlighted. */
export function ProjectNav({ project, projects }: { project: { slug: string; name: string }; projects: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const base = `/p/${project.slug}`;
  const current = SECTIONS.slice()
    .reverse()
    .find((s) => (s.path === "" ? pathname === base || pathname.startsWith(`${base}/systems`) : pathname.startsWith(base + s.path)));

  return (
    <div className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="font-semibold">
              {project.name}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Switch project</DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem key={p.slug} asChild>
                <Link href={`/p/${p.slug}`}>{p.name}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/">All projects</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <nav className="flex flex-wrap gap-1 text-sm">
          {SECTIONS.map((s) => (
            <Button key={s.label} variant="ghost" size="sm" asChild className={cn(current === s && "bg-muted")}>
              <Link href={base + s.path} aria-current={current === s ? "page" : undefined}>
                {s.label}
              </Link>
            </Button>
          ))}
        </nav>
      </div>
    </div>
  );
}
