"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";

/** Label style shared by the settings forms. */
const LABEL = "text-[12.5px] font-semibold text-fg-2";

/**
 * The General settings: name, slug, description and repository, and the danger
 * zone deleting the project. Owners edit; everyone else sees the values as text.
 */
export function ProjectSettings({
  slug,
  name,
  description,
  repoUrl,
  canEdit,
}: {
  slug: string;
  name: string;
  description: string;
  repoUrl: string | null;
  canEdit: boolean;
}) {
  if (!canEdit) return <ProjectSettingsReadOnly slug={slug} name={name} description={description} repoUrl={repoUrl} />;
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <GeneralForm slug={slug} name={name} description={description} repoUrl={repoUrl} />
      <DangerZone slug={slug} />
    </div>
  );
}

/** The editable General panel. */
function GeneralForm({ slug, name, description, repoUrl }: { slug: string; name: string; description: string; repoUrl: string | null }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.update.mutationOptions());
  const pending = update.isPending;
  const [draft, setDraft] = useState({ name, description, repoUrl: repoUrl ?? "" });
  const dirty = draft.name !== name || draft.description !== description || draft.repoUrl !== (repoUrl ?? "");
  return (
    <form
      aria-busy={pending}
      className="flex flex-col gap-4 border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          { project: slug, patch: { ...draft, repoUrl: draft.repoUrl.trim() || null } },
          { onSuccess: () => toast.success("Settings saved") },
        );
      }}
    >
      <h2 className="font-display text-[19px] font-semibold">General</h2>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-name" className={LABEL}>
            Name
          </Label>
          <Input id="settings-name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-slug" className={LABEL}>
            Slug
          </Label>
          <Input id="settings-slug" value={slug} disabled className="font-mono text-[13px]" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-description" className={LABEL}>
          Description
        </Label>
        <Textarea
          id="settings-description"
          rows={3}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-repo" className={LABEL}>
          Repository
        </Label>
        <Input
          id="settings-repo"
          type="url"
          placeholder="https://github.com/…"
          aria-describedby="settings-repo-help"
          value={draft.repoUrl}
          onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })}
        />
        <p id="settings-repo-help" className="text-xs text-muted-foreground">
          Commit hashes in updates link here.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !dirty || !draft.name.trim()}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

/** The danger zone: type the slug, then delete the project. */
function DangerZone({ slug }: { slug: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const remove = useMutation({ ...trpc.projects.delete.mutationOptions(), meta: { leavesProject: slug } });
  const pending = remove.isPending;
  const [confirm, setConfirm] = useState("");
  return (
    <section aria-busy={pending} className="flex flex-col gap-3 border border-destructive bg-card p-4 sm:p-5">
      <h2 className="font-display text-[19px] font-semibold text-destructive">Danger zone</h2>
      <p className="text-[13.5px] leading-normal text-fg-2">
        Deleting the project removes its boards, systems, documents, decisions, questions and history for everyone. This can’t be undone.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm !== slug) return;
          remove.mutate(
            { project: slug },
            {
              onSuccess: () => {
                toast.success("Project deleted");
                router.push("/");
              },
            },
          );
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="settings-delete-confirm" className={LABEL}>
            <span>
              Type <span className="font-mono">{slug}</span> to confirm
            </span>
          </Label>
          <Input
            id="settings-delete-confirm"
            className="font-mono text-[13px]"
            placeholder={slug}
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" variant="destructive" disabled={pending || confirm !== slug}>
          Delete project
        </Button>
      </form>
    </section>
  );
}

/** The General settings as plain text, for editors and viewers. */
function ProjectSettingsReadOnly({ slug, name, description, repoUrl }: { slug: string; name: string; description: string; repoUrl: string | null }) {
  const rows: [string, React.ReactNode][] = [
    ["Name", name],
    ["Slug", <span key="slug" className="font-mono text-[13px]">{slug}</span>],
    ["Description", description || <span key="d" className="text-muted-foreground">No description.</span>],
    [
      "Repository",
      repoUrl ? (
        <a key="r" href={repoUrl} target="_blank" rel="noreferrer" className="break-all text-brand-strong hover:underline">
          {repoUrl}
        </a>
      ) : (
        <span key="r" className="text-muted-foreground">Not linked.</span>
      ),
    ],
  ];
  return (
    <section className="flex max-w-[720px] flex-col gap-4 border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[19px] font-semibold">General</h2>
        <p className="text-[12.5px] text-muted-foreground">Only owners can change these settings.</p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className={LABEL}>{label}</dt>
            <dd className="text-[13.5px] leading-normal whitespace-pre-line">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
