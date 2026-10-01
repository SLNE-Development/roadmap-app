"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UPLOAD_LIMITS } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

/** An upload as the server returns it. */
export interface UploadedImage {
  id: string;
  url: string;
  originalName: string;
}

/** Posts `file` to the upload route and reports progress; rejects with the status and the server's message. */
function send(file: File, fields: Record<string, string>, onProgress: (percent: number) => void): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => {
      if (xhr.status === 201) resolve(JSON.parse(xhr.responseText) as UploadedImage);
      else reject(Object.assign(new Error(xhr.status === 413 || xhr.status === 415 ? String(xhr.status) : parseMessage(xhr.responseText)), { status: xhr.status }));
    };
    xhr.send(form);
  });
}

/** Reads the `error` text of a JSON error response, an empty string when there is none. */
function parseMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

/**
 * Picks one image by file input or drag and drop, uploads it with progress and shows a preview from the serving URL.
 * It holds no image state itself: the caller says which image is shown and handles the uploaded and removed events.
 *
 * @param props.requestId the request the image belongs to, null for a settings image
 * @param props.purpose what the image is for, as the upload route expects
 * @param props.image the image to preview, if any
 * @param props.disabled whether the picker is read-only
 * @param props.onUploaded called with the stored image once the upload succeeded
 * @param props.onRemove called with the id of the shown image when the remove button is used
 */
export function ImageUpload({
  requestId,
  purpose,
  image,
  disabled = false,
  onUploaded,
  onRemove,
}: {
  requestId: string | null;
  purpose: "banner" | "embed" | "fallback" | "template";
  image: { id: string; url: string } | null;
  disabled?: boolean;
  onUploaded: (image: UploadedImage) => void | Promise<void>;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("events.image");
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const mib = UPLOAD_LIMITS.maxBytes / 1024 / 1024;

  const upload = async (file: File | undefined) => {
    if (!file || disabled) return;
    setError(null);
    if (file.size > UPLOAD_LIMITS.maxBytes) return setError(t("tooLarge", { size: mib }));
    setProgress(0);
    try {
      await onUploaded(await send(file, { purpose, ...(requestId ? { requestId } : {}) }, setProgress));
    } catch (e) {
      const status = (e as { status?: number }).status;
      const message = e instanceof Error ? e.message : "";
      setError(status === 413 ? t("tooLarge", { size: mib }) : status === 415 ? t("wrongType") : (status === 400 || status === 403 || status === 404) && message ? message : t("failed"));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {image && (
        <div className="flex flex-wrap items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the access-checked upload route */}
          <img src={image.url} alt={t("previewAlt")} className="max-h-48 max-w-full border object-contain" />
          {!disabled && (
            <Button type="button" variant="outline" size="sm" onClick={() => onRemove(image.id)}>
              {t("remove")}
            </Button>
          )}
        </div>
      )}
      {!disabled && (
        <div
          className={cn("flex flex-col items-start gap-2 border border-dashed px-4 py-4 text-[13px]", over && "bg-secondary")}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void upload(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            accept={UPLOAD_LIMITS.types.join(",")}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" disabled={progress !== null} aria-describedby={hintId} onClick={() => input.current?.click()}>
            {image ? t("replace") : t("choose")}
          </Button>
          <p id={hintId} className="text-fg-2">
            {t("hint", { size: mib })}
          </p>
          {progress !== null && (
            <div className="flex w-full max-w-xs flex-col gap-1" role="status">
              <progress className="h-1.5 w-full" max={100} value={progress} aria-label={t("progress")} />
              <span className="text-xs text-muted-foreground">{t("uploading", { percent: progress })}</span>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
