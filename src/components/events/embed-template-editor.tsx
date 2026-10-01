"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { ImageUpload } from "@/components/events/image-upload";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DEFAULT_ALLOWED, PLACEHOLDERS, validateTemplate, type Placeholder } from "@/lib/event-placeholders";
import type { DetailsTemplate, EmbedTemplate } from "@/lib/event-templates";
import { useTRPC } from "@/trpc/client";

/** What the editor edits: the disaster and resolved messages are embeds with a title, text and image; the details message is lines and a footer. */
export type TemplateEditorProps =
  | { kind: "disaster" | "resolved"; value: EmbedTemplate; onChange: (value: EmbedTemplate) => void; disabled: boolean }
  | { kind: "details"; value: DetailsTemplate; onChange: (value: DetailsTemplate) => void; disabled: boolean };

type EditableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Edits one message template with a live preview and the placeholders as chips that insert at the caret of the field
 * last used. Unknown or unavailable names show a warning; they stay in the text and are posted as written. The
 * preview is rendered by the server with a sample event and sends nothing.
 *
 * @param props.kind which template this is; `{note}` is offered only for the resolved one
 * @param props.value the template
 * @param props.onChange called with the changed template
 * @param props.disabled whether the template is read-only
 */
export function EmbedTemplateEditor(props: TemplateEditorProps) {
  const { kind, disabled } = props;
  const t = useTranslations("events.settings.template");
  const trpc = useTRPC();
  const id = useId();
  const allow: readonly Placeholder[] = kind === "resolved" ? PLACEHOLDERS : DEFAULT_ALLOWED;
  const [last, setLast] = useState<{ field: EditableField; set: (value: string) => void } | null>(null);
  const request = useMemo(() => ({ kind, template: props.value }) as { kind: "details"; template: DetailsTemplate } | { kind: "disaster" | "resolved"; template: EmbedTemplate }, [kind, props.value]);
  const settled = useDebouncedValue(request, 300);
  const preview = useQuery({ ...trpc.requests.settings.preview.queryOptions(settled), placeholderData: keepPreviousData });

  const texts = props.kind === "details" ? [...props.value.lines, props.value.footer] : [props.value.title, props.value.text];
  const unknown = [...new Set(texts.flatMap((text) => validateTemplate(text, allow)))];
  /** Remembers the focused field so a chip click can insert into it. */
  const track = (set: (value: string) => void) => (e: React.FocusEvent<EditableField>) => {
    setLast({ field: e.currentTarget, set });
  };
  const insert = (name: Placeholder) => {
    if (!last || disabled) return;
    const { field } = last;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const chip = `{${name}}`;
    last.set(field.value.slice(0, start) + chip + field.value.slice(end));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + chip.length, start + chip.length);
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {props.kind === "details" ? (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-lines`}>{t("lines")}</FieldLabel>
              <Textarea
                id={`${id}-lines`}
                rows={7}
                value={props.value.lines.join("\n")}
                disabled={disabled}
                onFocus={track((v) => props.onChange({ ...props.value, lines: v.split("\n") }))}
                onChange={(e) => props.onChange({ ...props.value, lines: e.target.value.split("\n") })}
              />
              <FieldDescription>{t("linesHelp")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-footer`}>{t("footer")}</FieldLabel>
              <Input
                id={`${id}-footer`}
                value={props.value.footer}
                maxLength={200}
                disabled={disabled}
                onFocus={track((v) => props.onChange({ ...props.value, footer: v }))}
                onChange={(e) => props.onChange({ ...props.value, footer: e.target.value })}
              />
            </Field>
            <Field className="max-w-40">
              <FieldLabel htmlFor={`${id}-color`}>{t("color")}</FieldLabel>
              <Input id={`${id}-color`} type="color" className="h-9 p-1" value={props.value.color} disabled={disabled} onChange={(e) => props.onChange({ ...props.value, color: e.target.value })} />
            </Field>
          </>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-title`}>{t("title")}</FieldLabel>
              <Input
                id={`${id}-title`}
                value={props.value.title}
                maxLength={256}
                disabled={disabled}
                onFocus={track((v) => props.onChange({ ...props.value, title: v }))}
                onChange={(e) => props.onChange({ ...props.value, title: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-text`}>{t("text")}</FieldLabel>
              <Textarea
                id={`${id}-text`}
                rows={5}
                value={props.value.text}
                maxLength={4096}
                disabled={disabled}
                onFocus={track((v) => props.onChange({ ...props.value, text: v }))}
                onChange={(e) => props.onChange({ ...props.value, text: e.target.value })}
              />
            </Field>
            <Field className="max-w-40">
              <FieldLabel htmlFor={`${id}-color`}>{t("color")}</FieldLabel>
              <Input id={`${id}-color`} type="color" className="h-9 p-1" value={props.value.color} disabled={disabled} onChange={(e) => props.onChange({ ...props.value, color: e.target.value })} />
            </Field>
            <ImageUpload
              requestId={null}
              purpose="template"
              image={props.value.imageUploadId ? { id: props.value.imageUploadId, url: `/api/uploads/${props.value.imageUploadId}` } : null}
              disabled={disabled}
              onUploaded={(image) => props.onChange({ ...props.value, imageUploadId: image.id })}
              onRemove={() => props.onChange({ ...props.value, imageUploadId: null })}
            />
          </>
        )}
        <div role="group" aria-label={t("placeholders")} className="flex flex-wrap gap-1.5">
          {allow.map((name) => (
            <button
              key={name}
              type="button"
              disabled={disabled}
              aria-label={t("insert", { name })}
              onClick={() => insert(name)}
              className="border px-2 py-0.5 font-mono text-xs text-fg-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            >
              {`{${name}}`}
            </button>
          ))}
        </div>
        {unknown.length > 0 && (
          <p role="status" className="text-[13px] font-medium text-fg-2">
            {unknown.map((name) => t("unknown", { name: `{${name}}` })).join(" ")}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2" aria-live="polite">
        <h4 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{t("preview")}</h4>
        {preview.data && (
          <div className="flex flex-col gap-1.5 border-l-4 bg-secondary px-4 py-3 text-[13px]" style={{ borderLeftColor: preview.data.color }}>
            {preview.data.kind === "embed" ? (
              <>
                {preview.data.title && <p className="font-semibold">{preview.data.title}</p>}
                <p className="whitespace-pre-wrap">{preview.data.text}</p>
                {preview.data.imageUploadId && (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the access-checked upload route
                  <img src={`/api/uploads/${preview.data.imageUploadId}`} alt="" className="max-h-40 max-w-full object-contain" />
                )}
              </>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{preview.data.lines.join("\n")}</p>
                {preview.data.footer && <p className="text-xs text-muted-foreground">{preview.data.footer}</p>}
              </>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("previewNote")}</p>
      </div>
    </div>
  );
}
