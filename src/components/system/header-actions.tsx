"use client";

import { useMutation } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ChevronDown, Link2, MoreHorizontal, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CategoryDot, StatusChip } from "@/components/chips";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ColumnCategory } from "@/db/schema";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { currentColumn, nextColumn, StatusMenu, useMoveSystem, type SystemControlsData } from "./controls";

/** Soft background and text of each category, for the status button (literal strings for Tailwind). */
const STATUS_BUTTON: Record<ColumnCategory, string> = {
  planning: "bg-cat-planning-soft text-cat-planning",
  todo: "bg-cat-todo-soft text-cat-todo",
  active: "bg-cat-active-soft text-cat-active",
  review: "bg-cat-review-soft text-cat-review",
  blocked: "bg-cat-blocked-soft text-cat-blocked",
  done: "bg-cat-done-soft text-cat-done",
};

/** The status as a chip-styled button with a chevron that opens the column menu; a plain chip for viewers. */
function StatusButton({ data, className }: { data: SystemControlsData; className?: string }) {
  const t = useTranslations("system.header");
  const column = currentColumn(data);
  if (!data.canEdit) return <StatusChip category={column.category} name={column.name} className={cn("h-[34px] px-3 text-[13.5px]", className)} />;
  return (
    <StatusMenu data={data}>
      <button
        type="button"
        aria-label={t("changeStatus", { name: column.name })}
        className={cn(
          "inline-flex h-[34px] shrink-0 items-center gap-2 border pr-2.5 pl-3 text-[13.5px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          STATUS_BUTTON[column.category],
          className,
        )}
      >
        <CategoryDot category={column.category} />
        {column.name}
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
    </StatusMenu>
  );
}

/** The primary contextual action: "Move to <next column>", or nothing when there is no sensible next step. */
function PrimaryMove({ data, className }: { data: SystemControlsData; className?: string }) {
  const t = useTranslations("system.header");
  const { pending, move, dialog } = useMoveSystem(data);
  const next = nextColumn(data);
  if (!data.canEdit || !next) return null;
  return (
    <>
      <Button className={className} disabled={pending} onClick={() => move(next)}>
        {t("moveTo", { name: next.name })}
      </Button>
      {dialog}
    </>
  );
}

/** The overflow menu: copy the link, and for editors reopen planning (after a confirmation) and archive or restore the system. */
function OverflowMenu({ data, canArchive }: { data: SystemControlsData; canArchive: boolean }) {
  const t = useTranslations("system.header");
  const tc = useTranslations("common");
  const [confirm, setConfirm] = useState(false);
  const trpc = useTRPC();
  const setArchived = useMutation(
    trpc.systems.setArchived.mutationOptions({ onSuccess: (_data, { archived }) => toast.success(archived ? t("archived") : t("restored")) }),
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t("moreActions")} className="text-fg-2">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() =>
              void navigator.clipboard.writeText(window.location.href.split("?")[0]).then(
                () => toast.success(t("linkCopied")),
                () => toast.error(t("linkCopyFailed")),
              )
            }
          >
            <Link2 />
            {t("copyLink")}
          </DropdownMenuItem>
          {data.canEdit && data.planningComplete && (
            <DropdownMenuItem onSelect={() => setConfirm(true)}>
              <RotateCcw />
              {t("reopenPlanning")}
            </DropdownMenuItem>
          )}
          {canArchive && (
            <DropdownMenuItem
              disabled={setArchived.isPending}
              onSelect={() => setArchived.mutate({ project: data.projectSlug, system: data.systemSlug, archived: !data.archived })}
            >
              {data.archived ? <ArchiveRestore /> : <Archive />}
              {data.archived ? tc("restore") : tc("archive")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReopenPlanningDialog open={confirm} onOpenChange={setConfirm} projectSlug={data.projectSlug} systemSlug={data.systemSlug} />
    </>
  );
}

/**
 * The actions of the system header: the status button and the primary move
 * (from 1024px; on phones they sit in {@link SystemActionBar}) and the overflow
 * menu. `canArchive` (editors of an active project) offers Archive or Restore.
 */
export function SystemHeaderActions({ data, canArchive }: { data: SystemControlsData; canArchive: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 lg:flex">
        <StatusButton data={data} />
        <PrimaryMove data={data} />
      </div>
      <OverflowMenu data={data} canArchive={canArchive} />
    </div>
  );
}

/** The phone's fixed bottom bar with the status button and the primary move, 48px tall. Editors only. */
export function SystemActionBar({ data }: { data: SystemControlsData }) {
  if (!data.canEdit) return null;
  const hasNext = nextColumn(data) !== null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
      <StatusButton data={data} className={cn("h-12 px-4 text-sm", !hasNext && "flex-1 justify-center")} />
      <PrimaryMove data={data} className="h-12 min-w-0 flex-1 text-[15px]" />
    </div>
  );
}

/** The confirmation dialog of reopening planning; confirming reopens it and toasts. */
function ReopenPlanningDialog({
  open,
  onOpenChange,
  projectSlug,
  systemSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  systemSlug: string;
}) {
  const t = useTranslations("system.header");
  const trpc = useTRPC();
  // Reopening hides the planning tab's button with this dialog, so the toast lives on the mutation.
  const reopen = useMutation(trpc.planning.reopen.mutationOptions({ onSuccess: () => toast.success(t("planningReopened")) }));
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("reopenTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("reopenDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keepClosed")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => reopen.mutate({ project: projectSlug, system: systemSlug })}>
            {t("reopenPlanning")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Reopens planning after a confirmation, as an outline button (planning tab). Editors only. */
export function ReopenPlanningButton({ projectSlug, systemSlug }: { projectSlug: string; systemSlug: string }) {
  const t = useTranslations("system.header");
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setConfirm(true)}>
        <RotateCcw />
        {t("reopenPlanning")}
      </Button>
      <ReopenPlanningDialog open={confirm} onOpenChange={setConfirm} projectSlug={projectSlug} systemSlug={systemSlug} />
    </>
  );
}
