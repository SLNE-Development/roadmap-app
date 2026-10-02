"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RepoCombobox } from "@/components/github/repo-combobox";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

/**
 * The repository field of a project form: the GitHub App's repositories as a combobox when the actor may link one,
 * else (also while loading, on an error, or after "Enter URL by hand") a plain URL input.
 *
 * @param props.id id of the URL input
 * @param props.value the repository URL text
 * @param props.onChange called with the new text and the picked `owner/repo`, or null when the text was typed
 * @param props.placeholder shown while the field is empty
 * @param props.describedBy id of the element describing the input
 */
export function RepoField({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string, picked: string | null) => void;
  placeholder: string;
  describedBy?: string;
}) {
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const options = { ...trpc.github.pickableRepos.queryOptions(), staleTime: 60_000 };
  const pickable = useQuery(options);
  const repos = useQuery({ ...options, select: (data) => data.repos });
  if (manual || !pickable.data?.canLink) {
    return (
      <Input
        id={id}
        type="url"
        placeholder={placeholder}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value, null)}
      />
    );
  }
  return (
    <RepoCombobox
      repos={repos}
      open={open}
      onOpenChange={setOpen}
      triggerText={value || placeholder}
      triggerMuted={!value}
      onPick={(repo) => {
        setOpen(false);
        onChange(`https://github.com/${repo.fullName}`, repo.fullName);
      }}
      footer={
        <div className="px-3 py-2 text-[12.5px]">
          <button type="button" className="font-medium text-brand-strong hover:underline" onClick={() => setManual(true)}>
            {t("picker.enterUrlByHand")}
          </button>
        </div>
      }
    />
  );
}
