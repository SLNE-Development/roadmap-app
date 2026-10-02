"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronsUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Tag } from "@/components/chips";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AvailableRepo } from "@/lib/ops/github-repos";

/** Why a repository cannot be picked, or null when it can. */
function linkedLabel(linked: AvailableRepo["linked"], t: ReturnType<typeof useTranslations<"integrations">>): string | null {
  if (!linked) return null;
  if (linked.here) return t("picker.linkedHere");
  return linked.projectName ? t("picker.linkedTo", { name: linked.projectName }) : t("picker.linkedElsewhere");
}

/**
 * A popover combobox of repositories grouped by owner. A repository linked to a project cannot be picked. The caller
 * owns the open state and decides what picking does.
 *
 * @param props.id id of the trigger button; when given, a form label names it instead of the default label
 * @param props.describedBy id of the element describing the trigger
 * @param props.repos the query of the repositories to list
 * @param props.open whether the popover is open
 * @param props.onOpenChange called when the popover opens or closes
 * @param props.onPick called with the repository the user chose
 * @param props.triggerText the placeholder, or the picked repository's name
 * @param props.triggerMuted true while the trigger shows a placeholder
 * @param props.disabled disables the trigger
 * @param props.githubLinked false when the person has no linked GitHub account: the footer then hints at linking one
 * @param props.footer rendered under a separator below the list
 * @param props.onCloseAutoFocus called when the popover closes, to take over the focus
 */
export function RepoCombobox({
  id,
  describedBy,
  repos,
  open,
  onOpenChange,
  onPick,
  triggerText,
  triggerMuted,
  disabled,
  githubLinked,
  footer,
  onCloseAutoFocus,
}: {
  id?: string;
  describedBy?: string;
  repos: UseQueryResult<AvailableRepo[], { message: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (repo: AvailableRepo) => void;
  triggerText: string;
  triggerMuted: boolean;
  disabled?: boolean;
  githubLinked?: boolean;
  footer?: React.ReactNode;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const t = useTranslations("integrations");
  const owners = [...new Set((repos.data ?? []).map((r) => r.ownerLogin))];
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-describedby={describedBy}
          aria-label={id ? undefined : t("picker.label")}
          disabled={disabled}
          className="flex h-[34px] w-full max-w-md items-center gap-2 border border-input bg-background px-2.5 text-left text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <span className={triggerMuted ? "flex-1 truncate text-muted-foreground" : "flex-1 truncate"}>{triggerText}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0" onCloseAutoFocus={onCloseAutoFocus}>
        <Command>
          <CommandInput placeholder={t("picker.search")} />
          <CommandList>
            {repos.isPending && <p className="px-3 py-4 text-[13px] text-muted-foreground">{t("picker.loading")}</p>}
            {repos.isError && <p className="px-3 py-4 text-[13px] text-destructive">{repos.error.message}</p>}
            {repos.isSuccess && <CommandEmpty>{t("picker.noMatch")}</CommandEmpty>}
            {owners.map((owner) => (
              <CommandGroup key={owner} heading={owner}>
                {(repos.data ?? [])
                  .filter((r) => r.ownerLogin === owner)
                  .map((r) => {
                    const linked = linkedLabel(r.linked, t);
                    return (
                      <CommandItem key={r.fullName} value={r.fullName} disabled={linked !== null} onSelect={() => onPick(r)}>
                        <span className="flex-1 truncate font-mono text-[13px]">{r.fullName}</span>
                        {linked ? <span className="text-xs text-muted-foreground">{linked}</span> : null}
                        <Tag>{r.private ? t("picker.private") : t("picker.public")}</Tag>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            ))}
          </CommandList>
          {githubLinked === false || footer ? (
            <>
              <CommandSeparator />
              {githubLinked === false ? (
                <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
                  <Link href="/settings/connections" className="font-medium text-brand-strong hover:underline">
                    {t("picker.linkGitHubHint")}
                  </Link>
                </p>
              ) : null}
              {footer}
            </>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
