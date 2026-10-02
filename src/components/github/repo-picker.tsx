"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { RepoCombobox } from "@/components/github/repo-combobox";
import { useTRPC } from "@/trpc/client";

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
  const picker = useQuery({ ...trpc.github.availableRepos.queryOptions({ project: slug }), enabled: open });
  const queryClient = useQueryClient();
  const link = useMutation(
    trpc.github.linkAppRepo.mutationOptions({
      onSuccess: async (repo) => {
        toast.success(t("github.linked", { name: repo.fullName }));
        await queryClient.invalidateQueries({ queryKey: trpc.github.pickableRepos.queryKey() });
      },
    }),
  );
  const installMore = useMutation(trpc.github.installMoreUrl.mutationOptions({ onSuccess: ({ url }) => window.location.assign(url) }));
  return (
    <RepoCombobox
      repos={{ ...picker, data: picker.data?.repos }}
      githubLinked={picker.data?.githubLinked}
      open={open}
      onOpenChange={setOpen}
      disabled={link.isPending}
      triggerText={t("picker.placeholder")}
      triggerMuted
      onPick={(r) => {
        setOpen(false);
        link.mutate({ project: slug, repo: { fullName: r.fullName } });
      }}
      onCloseAutoFocus={(e) => {
        if (!toManual.current) return;
        toManual.current = false;
        e.preventDefault();
        onManual();
      }}
      footer={
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
      }
    />
  );
}
