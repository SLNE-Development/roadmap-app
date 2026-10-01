"use client";

import { useMutation } from "@tanstack/react-query";
import { Bookmark, ChevronRight, Ellipsis } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

/** A saved view as the sidebar lists it. */
export interface SidebarView {
  id: string;
  name: string;
  path: string;
  query: string;
  pinned: boolean;
}

/** The address a view opens. */
export function viewHref(v: Pick<SidebarView, "path" | "query">): string {
  return v.query ? `${v.path}?${v.query}` : v.path;
}

/**
 * The sidebar's "Views" group: the pinned views as links, each with a menu to
 * rename, unpin or delete it, and the unpinned ones in a collapsed "More views"
 * disclosure with a Pin option. Renders nothing without views.
 */
export function SidebarViews({ views }: { views: SidebarView[] }) {
  const trpc = useTRPC();
  const [renaming, setRenaming] = useState<SidebarView | null>(null);
  const [name, setName] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const onError = (error: { message: string }) => toast.error(error.message);
  const rename = useMutation(trpc.views.rename.mutationOptions({ onSuccess: () => setRenaming(null), onError }));
  const setPinned = useMutation(trpc.views.setPinned.mutationOptions({ onError }));
  const remove = useMutation(trpc.views.delete.mutationOptions({ onError }));
  if (views.length === 0) return null;
  const pinned = views.filter((v) => v.pinned);
  const more = views.filter((v) => !v.pinned);
  const renderView = (v: SidebarView) => (
    <div key={v.id} className="group/view flex items-center text-fg-2 hover:bg-sidebar-accent/60 hover:text-foreground">
      <Link href={viewHref(v)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-[13px] outline-none focus-visible:underline">
        <Bookmark className="size-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="truncate">{v.name}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for view ${v.name}`}
            className="mr-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground opacity-0 outline-none group-focus-within/view:opacity-100 group-hover/view:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100"
          >
            <Ellipsis className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuItem
            onSelect={() => {
              setName(v.name);
              setRenaming(v);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPinned.mutate({ id: v.id, pinned: !v.pinned })}>{v.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate({ id: v.id })}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Views</div>
      {pinned.map(renderView)}
      {more.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-label={`More views (${more.length})`}
            onClick={() => setMoreOpen((o) => !o)}
            className="flex items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
          >
            <ChevronRight className={`size-3.5 shrink-0 transition-transform ${moreOpen ? "rotate-90" : ""}`} aria-hidden />
            <span>More views ({more.length})</span>
          </button>
          {moreOpen && more.map(renderView)}
        </>
      )}
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming) rename.mutate({ id: renaming.id, name });
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename view</DialogTitle>
            </DialogHeader>
            <Input aria-label="View name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={rename.isPending || !name.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
