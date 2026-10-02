"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** A small mono chip showing `refText` that copies it to the clipboard on click and toasts. */
export function CopyRef({ refText, className }: { refText: string; className?: string }) {
  const t = useTranslations("tasks.ref");
  return (
    <button
      type="button"
      aria-label={t("copyRef", { ref: refText })}
      onClick={() => {
        navigator.clipboard.writeText(refText).then(
          () => toast.success(t("refCopied", { ref: refText })),
          () => toast.error(t("refCopyFailed")),
        );
      }}
      className={cn(
        "inline-flex cursor-pointer items-center font-mono text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {refText}
    </button>
  );
}
