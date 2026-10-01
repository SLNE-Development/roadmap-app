"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Tag } from "@/components/chips";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AvailableRepo } from "@/lib/ops/github-repos";
import { useTRPC } from "@/trpc/client";

/** Why a repository cannot be picked, or null when it can. */
function linkedLabel(linked: AvailableRepo["linked"], t: ReturnType<typeof useTranslations<"integrations">>): string | null {
  if (!linked) return null;
  if (linked.here) return t("picker.linkedHere");
  return linked.projectName ? t("picker.linkedTo", { name: linked.projectName }) : t("picker.linkedElsewhere");
}

/**
 * A combobox of the repositories the GitHub App can see, grouped by owner; picking one links it to the project.
 * Its footer offers installing the App on more repositories or entering a name by hand.
 *
 * @param props.slug the project slug
 * @param props.onManual called when the user wants to enter `owner/repo` by hand
 */
export function RepoPicker({ slug, onManual }: { slug: string; onManual: () => void }) {
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  // Set when the popover closes towards the manual form, which then gets the focus instead of the trigger.
  const toManual = useRef(false);
  const repos = useQuery({ ...trpc.github.availableRepos.queryOptions({ project: slug }), enabled: open });
  const link = useMutation(trpc.github.linkAppRepo.mutationOptions({ onSuccess: (repo) => toast.success(t("github.linked", { name: repo.fullName })) }));
  const installMore = useMutation(trpc.github.installMoreUrl.mutationOptions({ onSuccess: ({ url }) => window.location.assign(url) }));
  const owners = [...new Set((repos.data ?? []).map((r) => r.ownerLogin))];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("picker.label")}
          disabled={link.isPending}
          className="flex h-[34px] w-full max-w-md items-center gap-2 border border-input bg-background px-2.5 text-left text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <span className="flex-1 truncate text-muted-foreground">{t("picker.placeholder")}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        onCloseAutoFocus={(e) => {
          if (!toManual.current) return;
          toManual.current = false;
          e.preventDefault();
          onManual();
        }}
      >
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
                      <CommandItem
                        key={r.fullName}
                        value={r.fullName}
                        disabled={linked !== null}
                        onSelect={() => {
                          setOpen(false);
                          link.mutate({ project: slug, repo: { fullName: r.fullName } });
                        }}
                      >
                        <span className="flex-1 truncate font-mono text-[13px]">{r.fullName}</span>
                        {linked ? <span className="text-xs text-muted-foreground">{linked}</span> : null}
                        <Tag>{r.private ? t("picker.private") : t("picker.public")}</Tag>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            ))}
          </CommandList>
          <CommandSeparator />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
            <span className="text-muted-foreground">{t("picker.notListed")}</span>
            <button
              type="button"
              disabled={installMore.isPending}
              className="font-medium text-brand-strong hover:underline disabled:opacity-50"
              onClick={() => installMore.mutate({ project: slug })}
            >
              {t("picker.installMore")}
            </button>
            <button
              type="button"
              className="font-medium text-brand-strong hover:underline"
              onClick={() => {
                toManual.current = true;
                setOpen(false);
              }}
            >
              {t("picker.enterByHand")}
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
