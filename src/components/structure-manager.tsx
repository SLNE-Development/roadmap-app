"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** A domain as the structure settings show it. */
export interface StructureDomain {
  id: string;
  name: string;
  description: string;
  systemCount: number;
}

/** A phase as the structure settings show it, with the ids it builds on. */
export interface StructurePhase {
  id: string;
  name: string;
  goal: string;
  dependsOn: string[];
}

/** Two-digit phase number, as on the roadmap ("01"). */
const phaseNumber = (index: number) => String(index + 1).padStart(2, "0");

/** Returns `ids` with the entry at `index` swapped with its neighbour in direction `dir`. */
function swapped(ids: string[], index: number, dir: -1 | 1): string[] {
  const next = [...ids];
  [next[index], next[index + dir]] = [next[index + dir], next[index]];
  return next;
}

/**
 * Up/down reordering of a list through a mutation. Returns `move`, which
 * sends the new order, and restores keyboard focus to the moved row's arrow
 * once the list has re-rendered (the other arrow when the row reached an end).
 */
function useReorder(ids: string[], pending: boolean, send: (orderedIds: string[]) => void) {
  const focusAfter = useRef<{ id: string; dir: -1 | 1 } | null>(null);
  const move = (index: number, dir: -1 | 1) => {
    focusAfter.current = { id: ids[index], dir };
    send(swapped(ids, index, dir));
  };
  const key = ids.join(",");
  useEffect(() => {
    const target = focusAfter.current;
    if (pending || !target) return;
    focusAfter.current = null;
    const button = (dir: -1 | 1) => document.querySelector<HTMLButtonElement>(`[data-move="${target.id}:${dir}"]`);
    const same = button(target.dir);
    (same && !same.disabled ? same : button(target.dir === -1 ? 1 : -1))?.focus();
  }, [pending, key]);
  return move;
}

/** The panel frame of the structure settings: a heading row with a hint on the right. */
function StructurePanel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex items-baseline gap-2 px-4 py-3.5">
        <h2 className="flex-1 font-display text-[19px] font-semibold">{title}</h2>
        <span className="text-[12.5px] text-muted-foreground">{hint}</span>
      </header>
      {children}
    </section>
  );
}

/** The "Add …" row at the bottom of a panel that opens its form. */
function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 border-t px-4 py-2.5 text-left text-[13px] font-semibold text-brand-strong outline-none hover:bg-muted focus-visible:bg-muted"
    >
      <PlusIcon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

/** The edit controls of a row: move up, move down and edit. */
function RowControls({
  id,
  name,
  index,
  count,
  disabled,
  onMove,
  onEdit,
}: {
  id: string;
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onEdit: () => void;
}) {
  return (
    <span className="-my-1 flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${name} up`}
        data-move={`${id}:-1`}
        disabled={disabled || index === 0}
        onClick={() => onMove(index, -1)}
        className="text-muted-foreground"
      >
        <ArrowUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${name} down`}
        data-move={`${id}:1`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, 1)}
        className="text-muted-foreground"
      >
        <ArrowDownIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${name}`} disabled={disabled} onClick={onEdit} className="text-muted-foreground">
        <PencilIcon />
      </Button>
    </span>
  );
}

/** A confirm-then-delete icon button for a domain or phase row. */
function DeleteButton({ label, title, description, disabled, onConfirm }: { label: string; title: string; description: string; disabled: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} className="-my-1 text-muted-foreground">
          <XIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The structure settings: domains (with their system counts) and phases (with
 * what they build on), each with a form to add one, inline editing, up/down
 * reordering and deletion. Editors and above edit; viewers read.
 */
export function StructureManager({
  projectSlug,
  domains,
  phases,
  canEdit,
}: {
  projectSlug: string;
  domains: StructureDomain[];
  phases: StructurePhase[];
  canEdit: boolean;
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <DomainsPanel projectSlug={projectSlug} domains={domains} canEdit={canEdit} />
      <PhasesPanel projectSlug={projectSlug} phases={phases} canEdit={canEdit} />
    </div>
  );
}

/** The add or edit form of a domain: name and description. */
function DomainForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: { name: string; description: string };
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: { name: string; description: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  return (
    <form
      className="flex flex-col gap-2 border-t bg-muted/40 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, description });
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <Input aria-label="Domain name" placeholder="Name, e.g. Vehicles" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        aria-label="Domain description"
        placeholder="What belongs here (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Domains: name, description and system count per row; add, edit, reorder and delete. */
function DomainsPanel({ projectSlug, domains, canEdit }: { projectSlug: string; domains: StructureDomain[]; canEdit: boolean }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.structure.createDomain.mutationOptions());
  const update = useMutation(trpc.structure.updateDomain.mutationOptions());
  // The toast lives on the hook: the deleted row is gone once the refetch settles.
  const remove = useMutation(
    trpc.structure.deleteDomain.mutationOptions({
      onMutate: ({ id }) => domains.find((d) => d.id === id)?.name,
      onSuccess: (_data, _input, name) => toast.success(`Domain ${name ?? ""} deleted`),
    }),
  );
  const reorder = useMutation(trpc.structure.reorderDomains.mutationOptions());
  const pending = create.isPending || update.isPending || remove.isPending || reorder.isPending;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const move = useReorder(
    domains.map((d) => d.id),
    pending,
    (orderedIds) => reorder.mutate({ project: projectSlug, orderedIds }),
  );
  return (
    <StructurePanel title="Domains" hint="Group systems by area">
      <ul aria-busy={pending}>
        {domains.map((d, i) =>
          editing === d.id ? (
            <li key={d.id}>
              <DomainForm
                initial={d}
                submitLabel="Save domain"
                pending={pending}
                onCancel={() => setEditing(null)}
                onSubmit={(value) =>
                  update.mutate(
                    { project: projectSlug, id: d.id, patch: value },
                    {
                      onSuccess: () => {
                        toast.success(`Domain ${value.name.trim()} saved`);
                        setEditing(null);
                      },
                    },
                  )
                }
              />
            </li>
          ) : (
            <li key={d.id} className="flex items-start gap-2.5 border-t px-4 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold">{d.name}</span>
                {d.description && <span className="text-[12.5px] text-muted-foreground">{d.description}</span>}
              </span>
              <span className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {d.systemCount === 0 ? "No systems" : d.systemCount === 1 ? "1 system" : `${d.systemCount} systems`}
              </span>
              {canEdit && (
                <>
                  <RowControls id={d.id} name={d.name} index={i} count={domains.length} disabled={pending} onMove={move} onEdit={() => setEditing(d.id)} />
                  <DeleteButton
                    label={`Delete ${d.name}`}
                    title={`Delete domain ${d.name}?`}
                    description={
                      d.systemCount > 0
                        ? `Its ${d.systemCount === 1 ? "system keeps" : `${d.systemCount} systems keep`} existing without a domain.`
                        : "No systems use it."
                    }
                    disabled={pending}
                    onConfirm={() =>
                      remove.mutate({ project: projectSlug, id: d.id })
                    }
                  />
                </>
              )}
            </li>
          ),
        )}
        {domains.length === 0 && (
          <li className="border-t px-4 py-4 text-[13px] text-muted-foreground">
            No domains yet.{canEdit && " Add areas such as Police or Vehicles to group systems."}
          </li>
        )}
      </ul>
      {canEdit &&
        (adding ? (
          <DomainForm
            initial={{ name: "", description: "" }}
            submitLabel="Add domain"
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={(value) =>
              create.mutate(
                { project: projectSlug, domain: value },
                {
                  onSuccess: () => {
                    toast.success(`Domain ${value.name.trim()} added`);
                    setAdding(false);
                  },
                },
              )
            }
          />
        ) : (
          <AddRow label="Add domain" onClick={() => setAdding(true)} />
        ))}
    </StructurePanel>
  );
}

/** Ids of the phases that build on `id`, directly or through other phases. */
function dependentsOf(id: string, phases: StructurePhase[]): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const at = stack.pop() as string;
    for (const p of phases) {
      if (p.dependsOn.includes(at) && !found.has(p.id)) {
        found.add(p.id);
        stack.push(p.id);
      }
    }
  }
  return found;
}

/**
 * The add or edit form of a phase: name, goal and the phases it builds on.
 * When editing, the phase itself and the phases that build on it are not
 * offered as dependencies, since they would form a cycle.
 */
function PhaseForm({
  phases,
  editing,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  phases: StructurePhase[];
  editing: string | null;
  initial: { name: string; goal: string; dependsOn: string[] };
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: { name: string; goal: string; dependsOn: string[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [dependsOn, setDependsOn] = useState<string[]>(initial.dependsOn);
  const index = editing ? phases.findIndex((p) => p.id === editing) : phases.length;
  const blocked = editing ? dependentsOf(editing, phases) : new Set<string>();
  const choices = phases.map((p, i) => ({ ...p, number: phaseNumber(i) })).filter((p) => p.id !== editing);
  const chosen = choices.filter((p) => dependsOn.includes(p.id)).map((p) => p.number);
  return (
    <form
      className="flex flex-col gap-2 border-t bg-muted/40 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, goal, dependsOn });
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="flex items-center gap-2">
        <span className="w-[18px] font-mono text-[11.5px] text-muted-foreground">{phaseNumber(index)}</span>
        <Input aria-label="Phase name" placeholder="Name, e.g. Closed beta" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Textarea aria-label="Phase goal" placeholder="Goal: what is true when this phase is done (optional)" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {choices.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="mr-auto font-normal">
                {chosen.length === 0 ? "Builds on nothing" : `Builds on: ${chosen.join(", ")}`}
                <ChevronDownIcon className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 min-w-56">
              {choices.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={dependsOn.includes(p.id)}
                  disabled={blocked.has(p.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) => setDependsOn((d) => (checked ? [...d, p.id] : d.filter((id) => id !== p.id)))}
                >
                  <span className="font-mono text-[11.5px] text-muted-foreground">{p.number}</span>
                  {p.name}
                  {blocked.has(p.id) && <span className="ml-auto text-xs text-muted-foreground">builds on this</span>}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Phases: number, name, goal and dependencies per row; add (with dependencies), edit, reorder and delete. */
function PhasesPanel({ projectSlug, phases, canEdit }: { projectSlug: string; phases: StructurePhase[]; canEdit: boolean }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.structure.createPhase.mutationOptions());
  const update = useMutation(trpc.structure.updatePhase.mutationOptions());
  // The toast lives on the hook: the deleted row is gone once the refetch settles.
  const remove = useMutation(
    trpc.structure.deletePhase.mutationOptions({
      onMutate: ({ id }) => phases.find((p) => p.id === id)?.name,
      onSuccess: (_data, _input, name) => toast.success(`Phase ${name ?? ""} deleted`),
    }),
  );
  const reorder = useMutation(trpc.structure.reorderPhases.mutationOptions());
  const pending = create.isPending || update.isPending || remove.isPending || reorder.isPending;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const move = useReorder(
    phases.map((p) => p.id),
    pending,
    (orderedIds) => reorder.mutate({ project: projectSlug, orderedIds }),
  );
  const numberOf = new Map(phases.map((p, i) => [p.id, phaseNumber(i)]));
  /** "After 03, 04" for a phase's dependencies, in phase order. */
  const after = (ids: string[]) =>
    `After ${phases
      .filter((p) => ids.includes(p.id))
      .map((p) => numberOf.get(p.id))
      .join(", ")}`;

  return (
    <StructurePanel title="Phases" hint="In delivery order">
      <ol aria-busy={pending}>
        {phases.map((p, i) =>
          editing === p.id ? (
            <li key={p.id}>
              <PhaseForm
                phases={phases}
                editing={p.id}
                initial={p}
                submitLabel="Save phase"
                pending={pending}
                onCancel={() => setEditing(null)}
                onSubmit={(value) =>
                  update.mutate(
                    { project: projectSlug, id: p.id, patch: value },
                    {
                      onSuccess: () => {
                        toast.success(`Phase ${value.name.trim()} saved`);
                        setEditing(null);
                      },
                    },
                  )
                }
              />
            </li>
          ) : (
            <li key={p.id} className="flex items-start gap-2.5 border-t px-4 py-2.5">
              <span className="w-[18px] pt-0.5 font-mono text-[11.5px] text-muted-foreground">{phaseNumber(i)}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold">{p.name}</span>
                {p.goal && <span className="text-[12.5px] text-muted-foreground">{p.goal}</span>}
              </span>
              <span
                className={cn(
                  "flex h-[26px] shrink-0 items-center border px-2 text-xs whitespace-nowrap",
                  p.dependsOn.length === 0 ? "border-dashed text-muted-foreground" : "text-fg-2",
                )}
              >
                {p.dependsOn.length === 0 ? "No dependencies" : after(p.dependsOn)}
              </span>
              {canEdit && (
                <>
                  <RowControls id={p.id} name={p.name} index={i} count={phases.length} disabled={pending} onMove={move} onEdit={() => setEditing(p.id)} />
                  <DeleteButton
                    label={`Delete ${p.name}`}
                    title={`Delete phase ${p.name}?`}
                    description="Its systems keep existing without a phase, and phases that build on it lose that dependency."
                    disabled={pending}
                    onConfirm={() =>
                      remove.mutate({ project: projectSlug, id: p.id })
                    }
                  />
                </>
              )}
            </li>
          ),
        )}
        {phases.length === 0 && (
          <li className="border-t px-4 py-4 text-[13px] text-muted-foreground">
            No phases yet.{canEdit && " Phases order delivery on the roadmap."}
          </li>
        )}
      </ol>
      {canEdit &&
        (adding ? (
          <PhaseForm
            phases={phases}
            editing={null}
            initial={{ name: "", goal: "", dependsOn: [] }}
            submitLabel="Add phase"
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={(value) =>
              create.mutate(
                { project: projectSlug, phase: value },
                {
                  onSuccess: () => {
                    toast.success(`Phase ${value.name.trim()} added`);
                    setAdding(false);
                  },
                },
              )
            }
          />
        ) : (
          <AddRow label="Add phase" onClick={() => setAdding(true)} />
        ))}
    </StructurePanel>
  );
}
