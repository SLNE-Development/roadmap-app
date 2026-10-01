"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useTRPC } from "@/trpc/client";

/**
 * A searchable list of the project's other systems; choosing one moves the task
 * there. The toast lives in the mutation options, because the task row unmounts.
 *
 * @param props.systemSlug the task's current system, which is left out of the list
 */
export function MoveTaskDialog({
  open,
  onOpenChange,
  projectSlug,
  systemSlug,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  systemSlug: string;
  task: { id: number; title: string };
}) {
  const trpc = useTRPC();
  const systems = useQuery({ ...trpc.systems.list.queryOptions({ project: projectSlug }), enabled: open });
  const others = (systems.data ?? []).filter((s) => s.slug !== systemSlug);
  const move = useMutation(
    trpc.tasks.move.mutationOptions({
      onSuccess: (_data, vars) => toast.success(`Moved to ${others.find((s) => s.slug === vars.to.system)?.title ?? vars.to.system}`),
    }),
  );
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Move to system" description={`Choose the system to move “${task.title}” to`}>
      <Command>
        <CommandInput placeholder="Search systems…" />
        <CommandList>
          <CommandEmpty>{systems.isPending ? "Loading systems…" : "No other systems."}</CommandEmpty>
          <CommandGroup heading="Move to system">
            {others.map((s) => (
              <CommandItem
                key={s.slug}
                value={`${s.title} ${s.slug}`}
                disabled={move.isPending}
                onSelect={() => move.mutate({ id: task.id, to: { system: s.slug } }, { onSuccess: () => onOpenChange(false) })}
              >
                {s.title}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
