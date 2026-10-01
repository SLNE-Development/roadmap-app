"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** A notice that something is archived and read-only, with a Restore button when `onRestore` is given. */
export function ArchivedBanner({
  message,
  onRestore,
  pending = false,
  className,
}: {
  message: string;
  onRestore?: () => void;
  pending?: boolean;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted px-3 py-2.5 text-[13px] text-fg-2", className)}>
      <Archive aria-hidden className="size-[15px] shrink-0" />
      <span className="flex-1">{message}</span>
      {onRestore && (
        <Button size="sm" variant="outline" disabled={pending} onClick={onRestore}>
          Restore
        </Button>
      )}
    </div>
  );
}

/** The project layout's banner while the project is archived; owners can restore it from here. */
export function ArchivedProjectBanner({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const { data: detail } = useSuspenseQuery(trpc.projects.get.queryOptions({ project: slug }));
  const restore = useMutation(trpc.projects.restore.mutationOptions({ onSuccess: () => toast.success("Project restored") }));
  if (!detail.project.archivedAt) return null;
  const canOwn = detail.role === "owner" || detail.role === "admin";
  return (
    <ArchivedBanner
      message="This project is archived and read-only."
      onRestore={canOwn ? () => restore.mutate({ project: slug }) : undefined}
      pending={restore.isPending}
      className="border-b px-4 sm:px-6 lg:px-9"
    />
  );
}
