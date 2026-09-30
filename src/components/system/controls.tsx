"use client";

import { Lock } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { moveSystemAction, updateSystemAction } from "@/app/(app)/p/[project]/actions";
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
import { useAction } from "@/components/use-action";
import { PRIORITIES, type ColumnCategory, type Priority } from "@/db/schema";
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
  canEdit: boolean;
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
 * when the gate refuses the move.
 */
export function useMoveSystem(data: SystemControlsData) {
  const [pending, startTransition] = useTransition();
  const move = (target: ColumnOption) => {
    const from = currentColumn(data);
    if (target.id === from.id) return;
    startTransition(async () => {
      const result = await moveSystemAction(data.projectSlug, data.systemSlug, { column: target.id });
      if (!result.ok) {
        if (!data.planningComplete && target.category !== "planning") planningGateToast(data.gaps);
        else toast.error(result.error);
        return;
      }
      toast.success(`Moved to ${target.name}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void moveSystemAction(data.projectSlug, data.systemSlug, { column: from.id }).then((r) =>
              r.ok ? toast.success(`Moved back to ${from.name}`) : toast.error(r.error),
            ),
        },
      });
    });
  };
  return { pending, move };
}

/**
 * The board's columns as a menu around `children` (the trigger). While planning
 * is incomplete, every column but planning is disabled with a hint.
 */
export function StatusMenu({ data, children, align = "end" }: { data: SystemControlsData; children: React.ReactNode; align?: "start" | "end" }) {
  const { pending, move } = useMoveSystem(data);
  return (
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
  onChoose: (value: string) => Parameters<typeof updateSystemAction>[2];
  children: React.ReactNode;
}) {
  const { pending, act } = useAction();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => {
            if (v === value) return;
            const chosen = options.find((o) => o.value === v)?.label ?? v;
            act(
              () => updateSystemAction(data.projectSlug, data.systemSlug, onChoose(v)),
              () => toast.success(`${label} set to ${chosen}`),
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
