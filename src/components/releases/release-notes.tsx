"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VersionPicker } from "@/components/version-picker";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The editor of release notes: a textarea with a Write/Preview switch, saved as a new version. */
function NotesEditor({
  projectSlug,
  releaseSlug,
  initial,
  onSaved,
  onCancel,
}: {
  projectSlug: string;
  releaseSlug: string;
  initial: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("insight.releases.notes");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const [body, setBody] = useState(initial);
  const [preview, setPreview] = useState(false);
  const save = useMutation(
    trpc.releases.writeNote.mutationOptions({
      onSuccess: ({ version }) => {
        toast.success(t("saved", { version }));
        onSaved();
      },
    }),
  );
  const tabClass = (active: boolean) =>
    cn("h-[26px] px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50", active ? "bg-card font-semibold" : "font-medium text-fg-2 hover:text-foreground");
  return (
    <form
      className="flex flex-col gap-3 px-4 pb-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ project: projectSlug, release: releaseSlug, body });
      }}
    >
      <div role="group" aria-label={t("editorMode")} className="flex w-fit bg-secondary p-[3px]">
        <button type="button" aria-pressed={!preview} className={tabClass(!preview)} onClick={() => setPreview(false)}>
          {t("write")}
        </button>
        <button type="button" aria-pressed={preview} className={tabClass(preview)} onClick={() => setPreview(true)}>
          {t("preview")}
        </button>
      </div>
      {preview ? (
        <div className="min-h-40 border px-3 py-2">{body.trim() ? <Markdown>{body}</Markdown> : <p className="text-[13px] text-muted-foreground">{t("nothingToPreview")}</p>}</div>
      ) : (
        <Textarea aria-label={t("title")} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-60 font-mono text-[13px]" />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || !body.trim()}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The notes tab of a release: the chosen version rendered as Markdown, a version picker, and for
 * editors an "Edit notes" button opening a textarea with preview that saves a new version.
 *
 * @param props.latest the newest version number, or `null` while there are no notes
 * @param props.version the version to show, the latest when undefined
 */
export function ReleaseNotes({
  projectSlug,
  releaseSlug,
  latest,
  version,
  canEdit,
}: {
  projectSlug: string;
  releaseSlug: string;
  latest: number | null;
  version: number | undefined;
  canEdit: boolean;
}) {
  const t = useTranslations("insight.releases.notes");
  const [editing, setEditing] = useState(false);
  return (
    <Panel
      title={t("title")}
      bodyClassName="pb-4"
      action={
        <>
          {/* Versions are append-only, so they are exactly 1..latest. */}
          {latest !== null && <VersionPicker param="version" versions={Array.from({ length: latest }, (_, i) => latest - i)} current={version ?? latest} />}
          {canEdit && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {t("edit")}
            </Button>
          )}
        </>
      }
    >
      {latest === null ? (
        editing ? (
          <NotesEditor projectSlug={projectSlug} releaseSlug={releaseSlug} initial="" onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        ) : (
          <p className="px-4 text-[13px] text-muted-foreground sm:px-5">{t("empty")}</p>
        )
      ) : (
        <Shown projectSlug={projectSlug} releaseSlug={releaseSlug} version={version} editing={editing} onDone={() => setEditing(false)} />
      )}
    </Panel>
  );
}

/** Loads the shown version and renders it, or its editor. */
function Shown({
  projectSlug,
  releaseSlug,
  version,
  editing,
  onDone,
}: {
  projectSlug: string;
  releaseSlug: string;
  version: number | undefined;
  editing: boolean;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const note = useSuspenseQuery(trpc.releases.note.queryOptions({ project: projectSlug, release: releaseSlug, version }));
  if (editing) {
    return (
      <NotesEditor
        key={note.data.version}
        projectSlug={projectSlug}
        releaseSlug={releaseSlug}
        initial={note.data.body}
        onCancel={onDone}
        // A saved version is the newest: leave an older pinned version behind.
        onSaved={() => {
          onDone();
          router.replace(`${pathname}?tab=notes`, { scroll: false });
        }}
      />
    );
  }
  return (
    <div className="px-4 sm:px-5">
      <Markdown>{note.data.body}</Markdown>
    </div>
  );
}
