"use client";

import { Check, ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One choice of a {@link FilterChip}: its label and the URL that applies it. */
export interface FilterOption {
  label: string;
  href: string;
  selected: boolean;
}

/**
 * A dashed filter chip opening a menu of URL choices. When a choice is
 * selected the chip is solid and names it, and the menu offers to clear it.
 */
export function FilterChip({ label, options, clearHref }: { label: string; options: FilterOption[]; clearHref: string }) {
  const current = options.find((o) => o.selected);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-8 items-center gap-1.5 border px-2.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          current ? "border-solid bg-card font-medium text-foreground" : "border-dashed text-fg-2 hover:text-foreground",
        )}
      >
        {current ? `${label}: ${current.label}` : label}
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 w-60">
        {options.length === 0 && <p className="px-2 py-1.5 text-[13px] text-muted-foreground">Nothing to filter by yet</p>}
        {options.map((o) => (
          <DropdownMenuItem key={o.href} asChild>
            <Link href={o.href}>
              <Check aria-hidden className={cn("size-3.5", !o.selected && "invisible")} />
              <span className="truncate">{o.label}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={clearHref}>
                <X aria-hidden className="size-3.5" />
                Clear filter
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A dashed toggle chip that links to its on or off state (such as "Agents only"). */
export function ToggleChip({ label, on, href }: { label: string; on: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-1.5 border px-2.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        on ? "border-primary bg-brand-soft font-medium text-brand-strong" : "border-dashed text-fg-2 hover:text-foreground",
      )}
    >
      {on && <Check aria-hidden className="size-3.5" />}
      {label}
      {on && <span className="sr-only"> (on)</span>}
    </Link>
  );
}
