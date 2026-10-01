"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/**
 * Editor of a project page: a markdown editor, saving the next version. The save
 * names the version it was opened on, so a newer version written meanwhile is refused with a message
 * instead of being overwritten; the text stays here to copy.
 *
 * @param props.page the latest version of the page, as opened
 * @param props.onClose called after a save or a cancel
 */
export function PageEditor({
  projectSlug,
  page,
  onClose,
}: {
  projectSlug: string;
  page: { slug: string; version: number; body: string };
  onClose: () => void;
}) {
  const t = useTranslations("pages.editor");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const [body, setBody] = useState(page.body);
  // The conflict message is shown here and stays until the next save, so the toast is skipped.
  const save = useMutation(
    trpc.pages.write.mutationOptions({
      meta: { quiet: true },
      onSuccess: ({ version }) => {
        toast.success(t("saved", { version }));
        onClose();
      },
    }),
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ project: projectSlug, page: page.slug, body, baseVersion: page.version });
      }}
    >
      <MarkdownEditor aria-label={t("bodyLabel")} value={body} maxLength={200_000} minRows={14} onChange={setBody} />
      {save.error && (
        <p role="alert" className="border border-destructive/40 bg-danger-soft px-3 py-2 text-[13px]">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !body.trim() || body.trim() === page.body.trim()}>
          {t("saveAs", { version: page.version + 1 })}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
