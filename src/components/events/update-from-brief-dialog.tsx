"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shows the instruction that makes the developer's own agent update a system from its changed brief. The app runs nothing:
 * the dialog only offers the command to copy.
 *
 * @param props.requestId the request whose brief changed
 */
export function UpdateFromBriefDialog({ requestId, open, onOpenChange }: { requestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("events.updateFromBrief");
  const command = `/surf-roadmap:requests update ${requestId}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <pre aria-label={t("commandLabel")} className="bg-secondary p-3 font-mono text-[12.5px] leading-[1.7] break-all whitespace-pre-wrap">
          {command}
        </pre>
        <p className="text-[13px] text-fg-2">{t("explain")}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("close")}</Button>
          </DialogClose>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                toast.success(t("copied"));
              } catch {
                toast.error(t("copyFailed"));
              }
            }}
          >
            <Copy aria-hidden />
            {t("copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
