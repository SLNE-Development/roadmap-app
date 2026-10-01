"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTRPC } from "@/trpc/client";

/** A release as the select needs it. */
export interface ReleaseOption {
  slug: string;
  name: string;
  status: "planned" | "frozen" | "shipped";
}

/**
 * The Release property of a system: a menu of the planned and frozen releases plus "No release".
 * Frozen releases are disabled for non-owners with the hint "Frozen: ask an owner"; a system
 * in a shipped release, or in a frozen one a non-owner cannot leave, shows the release as text.
 *
 * @param props.releases every release of the project
 * @param props.current the slug of the system's release, if any
 * @param props.isOwner whether the actor may change a frozen release's scope
 */
export function ReleaseSelect({
  projectSlug,
  systemSlug,
  releases,
  current,
  isOwner,
  className,
}: {
  projectSlug: string;
  systemSlug: string;
  releases: ReleaseOption[];
  current: string | null;
  isOwner: boolean;
  className: string;
}) {
  const trpc = useTRPC();
  const update = useMutation(trpc.systems.update.mutationOptions());
  const now = releases.find((r) => r.slug === current);
  const locked = now?.status === "shipped" || (now?.status === "frozen" && !isOwner);
  if (locked) {
    return (
      <span className="truncate" title={now.status === "frozen" ? "Frozen: ask an owner" : undefined}>
        {now.name}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={update.isPending}>
        <button type="button" aria-label={`Release: ${now?.name ?? "none"}. Change release`} className={className}>
          <span className="truncate">{now?.name ?? <span className="text-muted-foreground">No release</span>}</span>
          <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Release</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current ?? ""}
          onValueChange={(v) => {
            if (v === (current ?? "")) return;
            const chosen = releases.find((r) => r.slug === v)?.name ?? "No release";
            update.mutate(
              { project: projectSlug, system: systemSlug, patch: { release: v || null } },
              { onSuccess: () => toast.success(`Release set to ${chosen}`) },
            );
          }}
        >
          <DropdownMenuRadioItem value="">No release</DropdownMenuRadioItem>
          {releases
            .filter((r) => r.status !== "shipped")
            .map((r) => (
              <DropdownMenuRadioItem key={r.slug} value={r.slug} disabled={r.status === "frozen" && !isOwner}>
                {r.name}
                {r.status === "frozen" && <span className="text-muted-foreground">{isOwner ? "Frozen" : "Frozen: ask an owner"}</span>}
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
