"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import type { updateEventSettingsInput } from "@/lib/ops/event-settings";
import { useTRPC } from "@/trpc/client";

/** The fields one section may save; the settings update takes any subset. */
export type SettingsPatch = z.input<typeof updateEventSettingsInput>;

/**
 * The state of one settings section: the draft being typed, the baseline it is compared with and the save of that
 * section alone. The baseline is what was sent, so text typed while the save runs stays unsaved, and a refetch of the
 * settings never resets the draft.
 *
 * @param initial the saved values the section starts from
 * @param toPatch turns a draft into the fields to save
 */
export function useSectionDraft<T extends object>(initial: T, toPatch: (draft: T) => SettingsPatch) {
  const t = useTranslations("events.settings");
  const trpc = useTRPC();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const mutation = useMutation(trpc.requests.settings.update.mutationOptions());
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  return {
    draft,
    dirty,
    pending: mutation.isPending,
    /** Merges fields into the draft; pass a function to build them from the latest draft, e.g. after an upload finished. */
    patch: (part: Partial<T> | ((latest: T) => Partial<T>)) => setDraft((d) => ({ ...d, ...(typeof part === "function" ? part(d) : part) })),
    discard: () => setDraft(saved),
    save: () => {
      const sent = draft;
      mutation.mutate(toPatch(sent), {
        onSuccess: () => {
          setSaved(sent);
          toast.success(t("saved"));
        },
      });
    },
  };
}
