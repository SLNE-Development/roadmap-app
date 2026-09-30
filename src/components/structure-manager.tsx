"use client";

import { TrashIcon } from "lucide-react";
import { useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "./use-action";

/** Lists domains and phases with delete buttons and forms to add them. Editors and above. */
export function StructureManager({
  projectSlug,
  domains,
  phases,
}: {
  projectSlug: string;
  domains: { id: string; name: string; description: string }[];
  phases: { id: string; name: string; goal: string }[];
}) {
  const { pending, act } = useAction();
  const [domain, setDomain] = useState("");
  const [phase, setPhase] = useState("");
  const [goal, setGoal] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy={pending}>
      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
          <CardDescription>Areas that group systems, such as Police or Vehicles.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="divide-y rounded-md border">
            {domains.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{d.name}</span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} disabled={pending}>
                      <TrashIcon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete domain {d.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Systems in this domain lose their domain.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => act(() => deleteDomainAction(projectSlug, d.id))}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
            {domains.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No domains.</li>}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () => createDomainAction(projectSlug, { name: domain }),
                () => setDomain(""),
              );
            }}
          >
            <Input aria-label="New domain" placeholder="New domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Button type="submit" variant="outline" disabled={pending || !domain.trim()}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Phases</CardTitle>
          <CardDescription>Delivery phases in order, shown on the roadmap.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ol className="divide-y rounded-md border">
            {phases.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">
                  {p.name}
                  {p.goal && <span className="text-muted-foreground"> · {p.goal}</span>}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} disabled={pending}>
                      <TrashIcon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete phase {p.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Systems in this phase lose their phase.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => act(() => deletePhaseAction(projectSlug, p.id))}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
            {phases.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No phases.</li>}
          </ol>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () => createPhaseAction(projectSlug, { name: phase, goal }),
                () => {
                  setPhase("");
                  setGoal("");
                },
              );
            }}
          >
            <Input aria-label="New phase" placeholder="New phase" value={phase} onChange={(e) => setPhase(e.target.value)} />
            <Input aria-label="Goal" placeholder="Goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <Button type="submit" variant="outline" className="self-start" disabled={pending || !phase.trim()}>
              Add phase
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
