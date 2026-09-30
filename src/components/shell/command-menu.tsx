"use client";

import { Activity, CircleHelp, FolderKanban, KanbanSquare, KeyRound, LayoutGrid, List, Map as MapIcon, Moon, Scale, SlidersHorizontal, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

/** Browser event that opens the command menu from anywhere, e.g. the sidebar search button. */
const OPEN_EVENT = "roadmap:open-command-menu";

/** Opens the command menu. */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** What the command menu can jump to. */
export interface CommandMenuData {
  isAdmin: boolean;
  projects: { slug: string; name: string }[];
  project?: { slug: string; name: string; boards: { slug: string; name: string }[] };
  systems?: { slug: string; title: string }[];
}

/**
 * The ⌘K / Ctrl+K palette: jump to a section, board or system of the current
 * project, another project, or an account page, and switch the theme.
 */
export function CommandMenu({ data }: { data: CommandMenuData }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const base = data.project ? `/p/${data.project.slug}` : "";
  const sections = [
    { href: base, label: "Overview", icon: LayoutGrid },
    { href: `${base}/systems`, label: "Systems", icon: List },
    { href: `${base}/roadmap`, label: "Roadmap", icon: MapIcon },
    { href: `${base}/adrs`, label: "Decisions", icon: Scale },
    { href: `${base}/questions`, label: "Questions", icon: CircleHelp },
    { href: `${base}/activity`, label: "Activity", icon: Activity },
    { href: `${base}/settings`, label: "Project settings", icon: SlidersHorizontal },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a project, system or page">
      <Command>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {data.project && (
          <CommandGroup heading={data.project.name}>
            {sections.map((s) => (
              <CommandItem key={s.href} value={`${data.project?.name} ${s.label}`} onSelect={() => go(s.href)}>
                <s.icon /> {s.label}
              </CommandItem>
            ))}
            {data.project.boards.map((b) => (
              <CommandItem key={b.slug} value={`board ${b.name}`} onSelect={() => go(`${base}/boards/${b.slug}`)}>
                <KanbanSquare /> Board: {b.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {data.systems && data.systems.length > 0 && (
          <CommandGroup heading="Systems">
            {data.systems.map((s) => (
              <CommandItem key={s.slug} value={`system ${s.title} ${s.slug}`} onSelect={() => go(`${base}/systems/${s.slug}`)}>
                <List /> {s.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Projects">
          {data.projects.map((p) => (
            <CommandItem key={p.slug} value={`project ${p.name} ${p.slug}`} onSelect={() => go(`/p/${p.slug}`)}>
              <FolderKanban /> {p.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Account">
          <CommandItem value="api keys" onSelect={() => go("/settings/api-keys")}>
            <KeyRound /> API keys
          </CommandItem>
          {data.isAdmin && (
            <CommandItem value="accounts admin allowlist" onSelect={() => go("/admin/users")}>
              <Users /> Accounts
            </CommandItem>
          )}
          <CommandItem
            value="theme dark light"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setOpen(false);
            }}
          >
            <Moon /> Toggle light and dark theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
