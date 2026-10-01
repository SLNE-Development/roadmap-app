"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** The footer of a card with unsaved changes: the notice with Discard and Save. Renders nothing while the card is clean. */
export function DirtyBar({ dirty, canSave, pending, saveLabel, onSave, onDiscard }: { dirty: boolean; canSave: boolean; pending: boolean; saveLabel?: string; onSave: () => void; onDiscard: () => void }) {
  const t = useTranslations("events.card");
  if (!dirty) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-secondary/50 px-4 py-3 sm:px-5">
      <span role="status" className="mr-auto text-[13px] font-medium text-fg-2">
        {t("unsaved")}
      </span>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDiscard}>
        {t("discard")}
      </Button>
      <Button type="button" size="sm" disabled={!canSave || pending} onClick={onSave}>
        {saveLabel ?? t("save")}
      </Button>
    </div>
  );
}
