"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { DiscordPreview } from "@/components/events/discord-preview";
import { ImageUpload } from "@/components/events/image-upload";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DEFAULT_ALLOWED, PLACEHOLDERS, validateTemplate, VISIBLE_PLACEHOLDERS, type Placeholder } from "@/lib/event-placeholders";
import type { DetailsTemplate, EmbedTemplate } from "@/lib/event-templates";
import { useTRPC } from "@/trpc/client";

/**
 * What the editor edits: the Störfall, resolved and cancelled messages are embeds with a title and text; the details
 * message is lines and a footer. Only the Störfall editor holds the image, which the resolved preview shows too
 * (`sharedImageId`).
 */
export type TemplateEditorProps = (
  | { kind: "disaster" | "resolved" | "cancelled"; value: EmbedTemplate; onChange: (value: EmbedTemplate) => void; sharedImageId?: string | null; onImageChange?: (imageUploadId: string | null) => void }
  | { kind: "details"; value: DetailsTemplate; onChange: (value: DetailsTemplate) => void }
) & { disabled: boolean; postAs: string; postAvatarUrl?: string | null; timeZone: string };

type EditableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Edits one message template with a live Discord preview beside it (below on phones) and the placeholders as chips
 * that insert at the caret of the field last used. Unknown or unavailable names show a warning; they stay in the text
 * and are posted as written. The preview is rendered by the server with a sample event and sends nothing.
 *
 * @param props.kind which template this is; `{note}` is offered in all but the details template
 * @param props.value the template
 * @param props.onChange called with the changed template
 * @param props.disabled whether the template is read-only
 * @param props.postAs the name the preview is signed with
 * @param props.timeZone the zone the preview shows times in
 */
export function EmbedTemplateEditor(props: TemplateEditorProps) {
  const { kind, disabled } = props;
  const t = useTranslations("events.settings.template");
  const locale = useLocale();
  const trpc = useTRPC();
  const id = useId();
  const allow: readonly Placeholder[] = kind === "details" ? DEFAULT_ALLOWED : PLACEHOLDERS;
  const chips: readonly Placeholder[] = kind === "details" ? VISIBLE_PLACEHOLDERS : [...VISIBLE_PLACEHOLDERS, "note"];
  const [last, setLast] = useState<{ field: EditableField; set: (value: string) => void } | null>(null);
  const request = useMemo(() => ({ kind, template: props.value }) as { kind: "details"; template: DetailsTemplate } | { kind: "disaster" | "resolved" | "cancelled"; template: EmbedTemplate }, [kind, props.value]);
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

  const shown = preview.data;
  const imageId = props.kind === "disaster" ? (shown?.kind === "embed" ? shown.imageUploadId : null) : props.kind === "resolved" ? (props.sharedImageId ?? null) : null;
  const embed = !shown
    ? null
    : shown.kind === "embed"
      ? { title: shown.title, description: shown.text, color: shown.color, imageUploadId: imageId, imageAs: "thumbnail" as const, fields: [], footer: "" }
      : { title: "", description: shown.lines.join("\n"), color: shown.color, imageUploadId: null, fields: [], footer: shown.footer };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
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
            {props.kind === "disaster" && (
              <div className="flex flex-col gap-2" role="group" aria-label={t("image")}>
                <span className="text-sm font-medium">{t("image")}</span>
                <ImageUpload
                  requestId={null}
                  purpose="template"
                  image={props.value.imageUploadId ? { id: props.value.imageUploadId, url: `/api/uploads/${props.value.imageUploadId}` } : null}
                  disabled={disabled}
                  onUploaded={(image) => (props.onImageChange ?? ((id) => props.onChange({ ...props.value, imageUploadId: id })))(image.id)}
                  onRemove={() => (props.onImageChange ?? ((id) => props.onChange({ ...props.value, imageUploadId: id })))(null)}
                />
                <p className="text-[13px] text-fg-2">{t("imageHelp")}</p>
              </div>
            )}
          </>
        )}
        <div role="group" aria-label={t("placeholders")} className="flex flex-wrap gap-1.5">
          {chips.map((name) => (
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
        <details className="text-[13px] text-fg-2">
          <summary className="cursor-pointer font-medium text-foreground">{t("placeholderHelp")}</summary>
          <p className="mt-2">{t("placeholderIntro")}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {chips.map((name) => (
              <div key={name} className="contents">
                <dt className="font-mono text-xs text-foreground">{`{${name}}`}</dt>
                <dd>{t(`meaning.${name}`)}</dd>
              </div>
            ))}
          </dl>
        </details>
        {unknown.length > 0 && (
          <p role="status" className="text-[13px] font-medium text-fg-2">
            {unknown.map((name) => t("unknown", { name: `{${name}}` })).join(" ")}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start" aria-live="polite">
        <h4 className="text-[13px] font-semibold">{t("preview")}</h4>
        {embed && <DiscordPreview parts={[{ kind: "embed", content: "", embed }]} postAs={props.postAs} avatarUrl={props.postAvatarUrl} locale={locale} timeZone={props.timeZone} />}
        <p className="text-xs text-muted-foreground">{t("previewNote")}</p>
      </div>
    </div>
  );
}
