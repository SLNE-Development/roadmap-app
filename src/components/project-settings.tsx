"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";

/** Label style shared by the settings forms. */
const LABEL = "text-[12.5px] font-semibold text-fg-2";

/**
 * The General settings: name, slug, description and repository, and the danger
 * zone archiving or deleting the project. Owners edit; everyone else sees the
 * values as text. An archived project is read-only, so owners keep only deleting it.
 */
export function ProjectSettings({
  slug,
  name,
  description,
  repoUrl,
  canEdit,
  archived,
}: {
  slug: string;
  name: string;
  description: string;
  repoUrl: string | null;
  canEdit: boolean;
  archived: boolean;
}) {
  const t = useTranslations("settings");
  if (!canEdit) return <ProjectSettingsReadOnly slug={slug} name={name} description={description} repoUrl={repoUrl} />;
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      {archived ? (
        <ProjectSettingsReadOnly slug={slug} name={name} description={description} repoUrl={repoUrl} note={t("general.archivedNote")} />
      ) : (
        <GeneralForm slug={slug} name={name} description={description} repoUrl={repoUrl} />
      )}
      <DangerZone slug={slug} archived={archived} />
    </div>
  );
}

/** The editable General panel. */
function GeneralForm({ slug, name, description, repoUrl }: { slug: string; name: string; description: string; repoUrl: string | null }) {
  const t = useTranslations("settings");
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
          { onSuccess: () => toast.success(t("general.saved")) },
        );
      }}
    >
      <h2 className="font-display text-[19px] font-semibold">{t("general.title")}</h2>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-name" className={LABEL}>
            {t("general.name")}
          </Label>
          <Input id="settings-name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-slug" className={LABEL}>
            {t("general.slug")}
          </Label>
          <Input id="settings-slug" value={slug} disabled className="font-mono text-[13px]" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-description" className={LABEL}>
          {t("general.description")}
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
          {t("general.repository")}
        </Label>
        <Input
          id="settings-repo"
          type="url"
          placeholder={t("general.repositoryPlaceholder")}
          aria-describedby="settings-repo-help"
          value={draft.repoUrl}
          onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })}
        />
        <p id="settings-repo-help" className="text-xs text-muted-foreground">
          {t("general.repositoryHelp")}
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !dirty || !draft.name.trim()}>
          {t("general.saveChanges")}
        </Button>
      </div>
    </form>
  );
}

/** Archives the project after a confirmation; it stays readable and an owner can restore it. */
function ArchiveProject({ slug }: { slug: string }) {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const archive = useMutation(trpc.projects.archive.mutationOptions({ onSuccess: () => toast.success(t("general.archived")) }));
  return (
    <div className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center sm:gap-4">
      <p className="flex-1 text-[13.5px] leading-normal text-fg-2">
        {t("general.archiveHint")}
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={archive.isPending}>
            {t("general.archiveButton")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("general.archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("general.archiveDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("general.keepActive")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => archive.mutate({ project: slug })}>{t("general.archiveButton")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The danger zone: archive the project (while it is active), or type the slug, then delete it. */
function DangerZone({ slug, archived }: { slug: string; archived: boolean }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const trpc = useTRPC();
  const remove = useMutation({ ...trpc.projects.delete.mutationOptions(), meta: { leavesProject: slug } });
  const pending = remove.isPending;
  const [confirm, setConfirm] = useState("");
  return (
    <section aria-busy={pending} className="flex flex-col gap-3 border border-destructive bg-card p-4 sm:p-5">
      <h2 className="font-display text-[19px] font-semibold text-destructive">{t("general.dangerZone")}</h2>
      {!archived && <ArchiveProject slug={slug} />}
      <p className="text-[13.5px] leading-normal text-fg-2">
        {t("general.deleteHint")}
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
                toast.success(t("general.deleted"));
                router.push("/");
              },
            },
          );
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="settings-delete-confirm" className={LABEL}>
            <span>{t.rich("general.confirmDelete", { slug, code: (chunks) => <span className="font-mono">{chunks}</span> })}</span>
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
          {t("general.deleteButton")}
        </Button>
      </form>
    </section>
  );
}

/** The General settings as plain text, for editors and viewers, and for owners of an archived project. */
function ProjectSettingsReadOnly({
  slug,
  name,
  description,
  repoUrl,
  note,
}: {
  slug: string;
  name: string;
  description: string;
  repoUrl: string | null;
  note?: string;
}) {
  const t = useTranslations("settings");
  const rows: [string, React.ReactNode][] = [
    [t("general.name"), name],
    [t("general.slug"), <span key="slug" className="font-mono text-[13px]">{slug}</span>],
    [t("general.description"), description || <span key="d" className="text-muted-foreground">{t("general.noDescription")}</span>],
    [
      t("general.repository"),
      repoUrl ? (
        <a key="r" href={repoUrl} target="_blank" rel="noreferrer" className="break-all text-brand-strong hover:underline">
          {repoUrl}
        </a>
      ) : (
        <span key="r" className="text-muted-foreground">{t("general.notLinked")}</span>
      ),
    ],
  ];
  return (
    <section className="flex max-w-[720px] flex-col gap-4 border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[19px] font-semibold">{t("general.title")}</h2>
        <p className="text-[12.5px] text-muted-foreground">{note ?? t("general.ownersOnly")}</p>
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
