"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  CircleHelp,
  FileText,
  FolderKanban,
  KanbanSquare,
  KeyRound,
  Laptop,
  LayoutGrid,
  List,
  ListChecks,
  Map as MapIcon,
  Keyboard,
  Moon,
  Rocket,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { SearchHit } from "@/lib/ops/search";
import { useTRPC } from "@/trpc/client";

/** Browser event that opens the command menu from anywhere, e.g. the sidebar search button. */
const OPEN_EVENT = "roadmap:open-command-menu";

/** Opens the command menu. */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The icon of each kind of document search hit. */
const HIT_ICON: Record<SearchHit["kind"], LucideIcon> = { system: List, spec: FileText, plan: ListChecks, adr: Scale, question: CircleHelp, page: BookOpen };

/** Renders a search snippet with the matched words (between `\u0002` and `\u0003`) as `<mark>`, never as HTML. */
function Snippet({ text }: { text: string }) {
  return text.split("\u0002").map((part, i) => {
    if (i === 0) return <span key={i}>{part}</span>;
    const [match, rest = ""] = part.split("\u0003");
    return (
      <span key={i}>
        <mark className="bg-brand-soft text-inherit">{match}</mark>
        {rest}
      </span>
    );
  });
}

/** What the command menu can jump to; callers pass active projects and systems only, leaving archived ones out. */
export interface CommandMenuData {
  isAdmin: boolean;
  projects: { slug: string; name: string }[];
  project?: { slug: string; name: string; boards: { slug: string; name: string }[] };
  systems?: { slug: string; title: string }[];
  pages?: { slug: string; title: string }[];
}

/**
 * The ⌘K / Ctrl+K palette: jump to a section, board or system of the current
 * project, another project, or an account page, and switch the theme. Inside a
 * project, two or more typed characters also search its documents.
 */
export function CommandMenu({ data, onShowShortcuts }: { data: CommandMenuData; onShowShortcuts: () => void }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  // The dialog unmounts its input when closed, so the next opening starts empty.
  if (!open && query !== "") setQuery("");
  const searchable = (q: string) => data.project !== undefined && q.replace(/\s/g, "").length >= 2;
  const debounced = useDebouncedValue(query.trim(), 200);
  const search = useQuery({
    ...trpc.search.project.queryOptions({ project: data.project?.slug ?? "", q: debounced }),
    enabled: open && searchable(debounced),
    placeholderData: keepPreviousData,
  });
  const showHits = searchable(query);
  const hits = showHits ? (search.data ?? []) : [];
  const searching = showHits && (search.isFetching || query.trim() !== debounced);

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
    { href: base, label: "Overview", icon: LayoutGrid, key: "o" },
    { href: `${base}/systems`, label: "Systems", icon: List, key: "s" },
    { href: `${base}/roadmap`, label: "Roadmap", icon: MapIcon, key: "r" },
    { href: `${base}/releases`, label: "Releases", icon: Rocket },
    { href: `${base}/adrs`, label: "Decisions", icon: Scale, key: "d" },
    { href: `${base}/pages`, label: "Pages", icon: BookOpen },
    { href: `${base}/questions`, label: "Questions", icon: CircleHelp, key: "q" },
    { href: `${base}/activity`, label: "Activity", icon: Activity, key: "a" },
    { href: `${base}/settings`, label: "Project settings", icon: SlidersHorizontal },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a project, system or page">
      <Command>
      <CommandInput placeholder="Search or jump to…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {data.project && (
          <CommandGroup heading={data.project.name}>
            {sections.map((s) => (
              <CommandItem key={s.href} value={`${data.project?.name} ${s.label}`} onSelect={() => go(s.href)}>
                <s.icon /> {s.label}
                {s.key && (
                  <CommandShortcut className="flex gap-1">
                    <Kbd>g</Kbd>
                    <Kbd>{s.key}</Kbd>
                  </CommandShortcut>
                )}
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
        {data.pages && data.pages.length > 0 && (
          <CommandGroup heading="Pages">
            {data.pages.map((p) => (
              <CommandItem key={p.slug} value={`page ${p.title} ${p.slug}`} onSelect={() => go(`${base}/pages/${p.slug}`)}>
                <BookOpen /> {p.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {/* Outside the group, which cmdk hides while it has no items. */}
        {searching && <div className="px-4 py-1.5 text-sm text-muted-foreground">Searching…</div>}
        {hits.length > 0 && (
          <CommandGroup heading="In documents">
            {hits.map((hit, i) => {
              const Icon = HIT_ICON[hit.kind];
              return (
                <CommandItem key={`${i} ${hit.kind} ${hit.href}`} value={`hit ${i} ${hit.kind} ${hit.href}`} keywords={[query]} onSelect={() => go(hit.href)} className="items-start">
                  <Icon className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{hit.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <Snippet text={hit.snippet} />
                    </span>
                  </span>
                </CommandItem>
              );
            })}
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
          <CommandItem value="sessions devices sign out" onSelect={() => go("/settings/sessions")}>
            <Laptop /> Sessions
          </CommandItem>
          {data.isAdmin && (
            <CommandItem value="accounts admin allowlist" onSelect={() => go("/admin/users")}>
              <Users /> Accounts
            </CommandItem>
          )}
          {data.isAdmin && (
            <CommandItem value="audit admin auth events failed calls keys" onSelect={() => go("/admin/audit")}>
              <ShieldCheck /> Audit
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
        <CommandGroup heading="Keyboard shortcuts">
          <CommandItem
            value="keyboard shortcuts help"
            onSelect={() => {
              setOpen(false);
              onShowShortcuts();
            }}
          >
            <Keyboard /> Keyboard shortcuts
            <CommandShortcut>
              <Kbd>?</Kbd>
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
