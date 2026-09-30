"use client";

import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createDomainAction, createPhaseAction, deleteDomainAction, deletePhaseAction } from "@/app/(app)/p/[project]/actions";
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
import { useAction } from "./use-action";

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
 * what they build on), each with a form to add one and deletion. Editors and
 * above edit; viewers read.
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

/** Domains: name, description and system count per row; add and delete. */
function DomainsPanel({ projectSlug, domains, canEdit }: { projectSlug: string; domains: StructureDomain[]; canEdit: boolean }) {
  const { pending, act } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const reset = () => {
    setAdding(false);
    setName("");
    setDescription("");
  };
  return (
    <StructurePanel title="Domains" hint="Group systems by area">
      <ul aria-busy={pending}>
        {domains.map((d) => (
          <li key={d.id} className="flex items-start gap-2.5 border-t px-4 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold">{d.name}</span>
              {d.description && <span className="text-[12.5px] text-muted-foreground">{d.description}</span>}
            </span>
            <span className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {d.systemCount === 0 ? "No systems" : d.systemCount === 1 ? "1 system" : `${d.systemCount} systems`}
            </span>
            {canEdit && (
              <DeleteButton
                label={`Delete ${d.name}`}
                title={`Delete domain ${d.name}?`}
                description={
                  d.systemCount > 0
                    ? `Its ${d.systemCount === 1 ? "system keeps" : `${d.systemCount} systems keep`} existing without a domain.`
                    : "No systems use it."
                }
                disabled={pending}
                onConfirm={() => act(() => deleteDomainAction(projectSlug, d.id), () => toast.success(`Domain ${d.name} deleted`))}
              />
            )}
          </li>
        ))}
        {domains.length === 0 && (
          <li className="border-t px-4 py-4 text-[13px] text-muted-foreground">
            No domains yet.{canEdit && " Add areas such as Police or Vehicles to group systems."}
          </li>
        )}
      </ul>
      {canEdit &&
        (adding ? (
          <form
            className="flex flex-col gap-2 border-t bg-muted/40 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () => createDomainAction(projectSlug, { name, description }),
                () => {
                  toast.success(`Domain ${name.trim()} added`);
                  reset();
                },
              );
            }}
          >
            <Input aria-label="Domain name" placeholder="Name, e.g. Vehicles" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              aria-label="Domain description"
              placeholder="What belongs here (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                Add domain
              </Button>
            </div>
          </form>
        ) : (
          <AddRow label="Add domain" onClick={() => setAdding(true)} />
        ))}
    </StructurePanel>
  );
}

/** Phases: number, name, goal and dependencies per row; add (with dependencies) and delete. */
function PhasesPanel({ projectSlug, phases, canEdit }: { projectSlug: string; phases: StructurePhase[]; canEdit: boolean }) {
  const { pending, act } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const reset = () => {
    setAdding(false);
    setName("");
    setGoal("");
    setDependsOn([]);
  };
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
        {phases.map((p, i) => (
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
              <DeleteButton
                label={`Delete ${p.name}`}
                title={`Delete phase ${p.name}?`}
                description="Its systems keep existing without a phase, and phases that build on it lose that dependency."
                disabled={pending}
                onConfirm={() => act(() => deletePhaseAction(projectSlug, p.id), () => toast.success(`Phase ${p.name} deleted`))}
              />
            )}
          </li>
        ))}
        {phases.length === 0 && (
          <li className="border-t px-4 py-4 text-[13px] text-muted-foreground">
            No phases yet.{canEdit && " Phases order delivery on the roadmap."}
          </li>
        )}
      </ol>
      {canEdit &&
        (adding ? (
          <form
            className="flex flex-col gap-2 border-t bg-muted/40 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () => createPhaseAction(projectSlug, { name, goal, dependsOn }),
                () => {
                  toast.success(`Phase ${name.trim()} added`);
                  reset();
                },
              );
            }}
          >
            <div className="flex items-center gap-2">
              <span className="w-[18px] font-mono text-[11.5px] text-muted-foreground">{phaseNumber(phases.length)}</span>
              <Input aria-label="Phase name" placeholder="Name, e.g. Closed beta" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Textarea aria-label="Phase goal" placeholder="Goal: what is true when this phase is done (optional)" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {phases.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="mr-auto font-normal">
                      {dependsOn.length === 0 ? "Builds on nothing" : `Builds on: ${after(dependsOn).slice("After ".length)}`}
                      <ChevronDownIcon className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 min-w-56">
                    {phases.map((p, i) => (
                      <DropdownMenuCheckboxItem
                        key={p.id}
                        checked={dependsOn.includes(p.id)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={(checked) => setDependsOn((d) => (checked ? [...d, p.id] : d.filter((id) => id !== p.id)))}
                      >
                        <span className="font-mono text-[11.5px] text-muted-foreground">{phaseNumber(i)}</span>
                        {p.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                Add phase
              </Button>
            </div>
          </form>
        ) : (
          <AddRow label="Add phase" onClick={() => setAdding(true)} />
        ))}
    </StructurePanel>
  );
}
