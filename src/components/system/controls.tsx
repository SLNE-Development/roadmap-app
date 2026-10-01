"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { CategoryDot } from "@/components/chips";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRIORITIES, type ColumnCategory, type Priority } from "@/db/schema";
import type { updateSystemInput } from "@/lib/ops/systems";
import { useTRPC } from "@/trpc/client";
import { isGateRefusal, moveErrorKind } from "./move-error";
import { MoveOverrideDialog } from "./move-override-dialog";
import { describeGaps } from "./text";

/** A column of the system's board as the controls need it. */
export interface ColumnOption {
  id: string;
  name: string;
  category: ColumnCategory;
}

/** Everything the system page's client controls read: where the system is and what can be chosen. */
export interface SystemControlsData {
  projectSlug: string;
  systemSlug: string;
  /** Whether the actor may change the system now; false while it or its project is archived. */
  canEdit: boolean;
  /** Whether the system is archived (read-only until restored). */
  archived: boolean;
  planningComplete: boolean;
  gaps: string[];
  columnId: string;
  columns: ColumnOption[];
  priority: Priority;
  ownerUserId: string | null;
  ownerName: string | null;
  members: { userId: string; name: string }[];
  domainId: string | null;
  domains: { id: string; name: string }[];
  phaseId: string | null;
  phases: { id: string; name: string }[];
}

/** Returns the system's current column, falling back to the first. */
export function currentColumn(data: SystemControlsData): ColumnOption {
  return data.columns.find((c) => c.id === data.columnId) ?? data.columns[0];
}

/**
 * Returns the column the primary action moves to: the next one in board order
 * that is not a blocked column, or `null` when the system is done, still in
 * planning, or at the end of the board.
 */
export function nextColumn(data: SystemControlsData): ColumnOption | null {
  const here = data.columns.findIndex((c) => c.id === data.columnId);
  if (!data.planningComplete || data.columns[here]?.category === "done") return null;
  return data.columns.slice(here + 1).find((c) => c.category !== "blocked" && c.category !== "planning") ?? null;
}

/** Shows the planning notice as a toast: the lock and what is still missing, in planning colours. */
export function planningGateToast(gaps: string[]) {
  toast(`Still in planning: ${describeGaps(gaps)}.`, {
    icon: <Lock className="size-4" />,
    classNames: { toast: "border-transparent! bg-cat-planning-soft! text-cat-planning!" },
  });
}

/**
 * Returns a pending flag and a `move` function that moves the system to a
 * column, toasts "Moved to …" with an undo, and shows the planning notice
 * when the gate refuses the move. When column rules refuse it and the viewer
 * is an owner, `dialog` (render it once) asks for a reason and retries with it.
 */
export function useMoveSystem(data: SystemControlsData) {
  const trpc = useTRPC();
  // Quiet: a refused move shows the planning notice instead of the error.
  const mutation = useMutation({ ...trpc.systems.move.mutationOptions(), meta: { quiet: true } });
  // Undo starts from the toast, possibly after leaving this page; the hook's `onSuccess`
  // still runs then, unlike a callback passed to `mutate`. Errors toast globally.
  const undo = useMutation(
    trpc.systems.move.mutationOptions({
      onSuccess: (_data, { to }) => toast.success(`Moved back to ${data.columns.find((c) => c.id === to.column)?.name ?? to.column}`),
    }),
  );
  const ref = { project: data.projectSlug, system: data.systemSlug };
  const { data: detail } = useQuery(trpc.projects.get.queryOptions({ project: data.projectSlug }));
  const canOwn = (detail?.role === "owner" || detail?.role === "admin") && !detail.project.archivedAt;
  const [refused, setRefused] = useState<{ target: ColumnOption; message: string } | null>(null);
  const move = (target: ColumnOption, overrideReason?: string) => {
    const from = currentColumn(data);
    if (target.id === from.id) return;
    mutation.mutate(
      { ...ref, to: { column: target.id, overrideReason } },
      {
        onError: (error) => {
          if (moveErrorKind(error) === "planning-gate") planningGateToast(data.gaps);
          else if (canOwn && !overrideReason && isGateRefusal(error)) setRefused({ target, message: error.message });
          else toast.error(error.message);
        },
        onSuccess: () => {
          setRefused(null);
          toast.success(`Moved to ${target.name}`, {
            action: {
              label: "Undo",
              onClick: () => undo.mutate({ ...ref, to: { column: from.id } }),
            },
          });
        },
      },
    );
  };
  const dialog = (
    <MoveOverrideDialog
      message={refused?.message ?? null}
      pending={mutation.isPending}
      onCancel={() => setRefused(null)}
      onConfirm={(reason) => refused && move(refused.target, reason)}
    />
  );
  return { pending: mutation.isPending || undo.isPending, move, dialog };
}

/**
 * The board's columns as a menu around `children` (the trigger). While planning
 * is incomplete, every column but planning is disabled with a hint.
 */
export function StatusMenu({ data, children, align = "end" }: { data: SystemControlsData; children: React.ReactNode; align?: "start" | "end" }) {
  const { pending, move, dialog } = useMoveSystem(data);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={pending}>
          {children}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-60">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={data.columnId}
            onValueChange={(id) => {
              const target = data.columns.find((c) => c.id === id);
              if (target) move(target);
            }}
          >
            {data.columns.map((c) => (
              <DropdownMenuRadioItem key={c.id} value={c.id} disabled={!data.planningComplete && c.category !== "planning"}>
                <CategoryDot category={c.category} />
                {c.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {!data.planningComplete && (
            <>
              <DropdownMenuSeparator />
              <p className="flex gap-2 px-1.5 py-1 text-xs leading-normal text-cat-planning">
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Other columns unlock when the planning interview is complete.
              </p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}

/** A generic single-choice menu around `children` (the trigger) that saves one system field. */
function FieldMenu({
  data,
  label,
  value,
  options,
  onChoose,
  children,
}: {
  data: SystemControlsData;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChoose: (value: string) => z.input<typeof updateSystemInput>;
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const update = useMutation(trpc.systems.update.mutationOptions());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={update.isPending}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => {
            if (v === value) return;
            const chosen = options.find((o) => o.value === v)?.label ?? v;
            update.mutate(
              { project: data.projectSlug, system: data.systemSlug, patch: onChoose(v) },
              { onSuccess: () => toast.success(`${label} set to ${chosen}`) },
            );
          }}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The priority menu around `children`. */
export function PriorityMenu({ data, children }: { data: SystemControlsData; children: React.ReactNode }) {
  return (
    <FieldMenu
      data={data}
      label="Priority"
      value={data.priority}
      options={PRIORITIES.map((p) => ({ value: p, label: p }))}
      onChoose={(v) => ({ priority: v as Priority })}
    >
      {children}
    </FieldMenu>
  );
}

/** The owner menu around `children`: nobody or a project member. */
export function OwnerMenu({ data, children }: { data: SystemControlsData; children: React.ReactNode }) {
  return (
    <FieldMenu
      data={data}
      label="Owner"
      value={data.ownerUserId ?? ""}
      options={[{ value: "", label: "Nobody" }, ...data.members.map((m) => ({ value: m.userId, label: m.name }))]}
      onChoose={(v) => ({ ownerUserId: v || null })}
    >
      {children}
    </FieldMenu>
  );
}

/** The domain menu around `children`. */
export function DomainMenu({ data, children }: { data: SystemControlsData; children: React.ReactNode }) {
  return (
    <FieldMenu
      data={data}
      label="Domain"
      value={data.domainId ?? ""}
      options={[{ value: "", label: "None" }, ...data.domains.map((d) => ({ value: d.id, label: d.name }))]}
      onChoose={(v) => ({ domainId: v || null })}
    >
      {children}
    </FieldMenu>
  );
}

/** The phase menu around `children`. */
export function PhaseMenu({ data, children }: { data: SystemControlsData; children: React.ReactNode }) {
  return (
    <FieldMenu
      data={data}
      label="Phase"
      value={data.phaseId ?? ""}
      options={[{ value: "", label: "None" }, ...data.phases.map((p) => ({ value: p.id, label: p.name }))]}
      onChoose={(v) => ({ phaseId: v || null })}
    >
      {children}
    </FieldMenu>
  );
}
