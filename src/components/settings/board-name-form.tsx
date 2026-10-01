"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";

/** The editable name of a board in settings; Save appears once the name changes. Owner only. */
export function BoardNameForm({ projectSlug, boardSlug, name }: { projectSlug: string; boardSlug: string; name: string }) {
  const t = useTranslations("settings");
  const [value, setValue] = useState(name);
  const trpc = useTRPC();
  const update = useMutation(trpc.boards.update.mutationOptions());
  const trimmed = value.trim();
  const changed = trimmed !== name && trimmed.length > 0;

  return (
    <form
      className="flex min-w-0 flex-1 flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        update.mutate({ project: projectSlug, board: boardSlug, patch: { name: trimmed } }, { onSuccess: () => toast.success(t("boardName.renamed")) });
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12.5px] font-semibold text-fg-2">
        {t("boardName.label")}
        <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className="font-normal text-foreground" />
      </label>
      {changed && (
        <Button type="submit" disabled={update.isPending}>
          {t("boardName.save")}
        </Button>
      )}
    </form>
  );
}
