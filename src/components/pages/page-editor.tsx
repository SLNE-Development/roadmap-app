"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";

/**
 * Editor of a project page: a markdown textarea with a preview, saving the next version. The save
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
  const trpc = useTRPC();
  const [body, setBody] = useState(page.body);
  const [preview, setPreview] = useState(false);
  // The conflict message is shown here and stays until the next save, so the toast is skipped.
  const save = useMutation(
    trpc.pages.write.mutationOptions({
      meta: { quiet: true },
      onSuccess: ({ version }) => {
        toast.success(`Saved as v${version}`);
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
      <div role="group" aria-label="Editor view" className="flex">
        <Button type="button" size="sm" variant={preview ? "outline" : "secondary"} aria-pressed={!preview} onClick={() => setPreview(false)}>
          Write
        </Button>
        <Button type="button" size="sm" variant={preview ? "secondary" : "outline"} aria-pressed={preview} onClick={() => setPreview(true)}>
          Preview
        </Button>
      </div>
      {preview ? (
        <div className="min-h-[320px] border bg-card px-4 py-5 sm:px-6">
          <Markdown>{body}</Markdown>
        </div>
      ) : (
        <Textarea
          aria-label="Page body (markdown)"
          className="min-h-[320px] font-mono text-[13px]"
          value={body}
          maxLength={200_000}
          onChange={(e) => setBody(e.target.value)}
        />
      )}
      {save.error && (
        <p role="alert" className="border border-destructive/40 bg-danger-soft px-3 py-2 text-[13px]">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !body.trim() || body.trim() === page.body.trim()}>
          Save as v{page.version + 1}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
