"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteProjectAction, updateProjectAction } from "@/app/(app)/p/[project]/actions";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Owner form for the project's name, description and repository URL, and project deletion. */
export function ProjectSettings({ slug, name, description, repoUrl }: { slug: string; name: string; description: string; repoUrl: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ name, description, repoUrl: repoUrl ?? "" });
  const [confirm, setConfirm] = useState("");
  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await updateProjectAction(slug, { ...draft, repoUrl: draft.repoUrl.trim() || null });
                if (result.ok) toast.success("Saved");
                else toast.error(result.error);
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                <Input id="settings-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-description">Description</FieldLabel>
                <Textarea id="settings-description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-repo">Repository URL</FieldLabel>
                <Input id="settings-repo" value={draft.repoUrl} onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })} />
              </Field>
              <Button type="submit" className="self-start" disabled={pending}>
                Save
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Delete project</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete project</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {name} and everything in it?</AlertDialogTitle>
                <AlertDialogDescription>
                  Boards, systems, specs, plans, ADRs, questions and history are removed. Type the slug <code>{slug}</code> to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input aria-label="Project slug" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={confirm !== slug}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteProjectAction(slug);
                      if (!result.ok) return void toast.error(result.error);
                      router.push("/");
                    })
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
