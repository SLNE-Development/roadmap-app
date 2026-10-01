"use client";

import { Bold, Code, FileCode, Heading, Italic, Link, List, ListChecks, ListOrdered, Minus, Quote, Strikethrough } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { continueList, indentLines, insertBlock, insertLink, toggleLinePrefix, touchesList, wrapSelection, type EditState } from "@/lib/markdown-edit";

type Mode = "write" | "preview" | "split";
type Action = "heading" | "bold" | "italic" | "strike" | "code" | "link" | "quote" | "bullets" | "numbers" | "tasks" | "codeBlock" | "rule";

const WIDE = "(min-width: 1024px)";

/** Whether the screen is wide enough for Split; false on the server so the first render matches. */
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(WIDE);
      query?.addEventListener("change", notify);
      return () => query?.removeEventListener("change", notify);
    },
    () => window.matchMedia?.(WIDE).matches ?? false,
    () => false,
  );
}

/**
 * Markdown textarea with a formatting toolbar, shortcuts (Ctrl/Cmd+B, I, K; Shift+Ctrl/Cmd+7 and 8), list continuation on Enter,
 * Tab indent in lists and a Write / Preview / Split switch. Edits go through `execCommand("insertText")` where the browser has it,
 * so undo keeps working.
 *
 * @param props.variant `compact` has a smaller toolbar and no Split mode, for dialogs
 * @param props.extraTools more toolbar buttons, shown after the formatting group
 * @param props.footer content at the bottom left, next to the character counter
 */
export function MarkdownEditor({
  value,
  onChange,
  id,
  "aria-label": ariaLabel,
  maxLength,
  minRows,
  placeholder,
  disabled,
  variant = "full",
  extraTools,
  footer,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  "aria-label"?: string;
  maxLength?: number;
  minRows?: number;
  placeholder?: string;
  disabled?: boolean;
  variant?: "full" | "compact";
  extraTools?: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("common.markdownEditor");
  const compact = variant === "compact";
  // Split is the default on wide screens until a mode is picked.
  const [picked, setMode] = useState<Mode | null>(null);
  const wide = useWide();
  const mode: Mode = picked ?? (!compact && wide ? "split" : "write");
  const area = useRef<HTMLTextAreaElement>(null);
  // The selection to restore after a change that had to go through React state.
  const pending = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    if (pending.current && area.current) {
      area.current.setSelectionRange(pending.current.start, pending.current.end);
      pending.current = null;
    }
  });

  /** Replaces only the changed middle of the text, so the browser records one undo step. */
  function apply(next: EditState) {
    const el = area.current;
    if (!el) return;
    const old = el.value;
    let head = 0;
    while (head < old.length && head < next.value.length && old[head] === next.value[head]) head++;
    let tail = 0;
    while (tail < old.length - head && tail < next.value.length - head && old[old.length - 1 - tail] === next.value[next.value.length - 1 - tail]) tail++;
    el.focus();
    el.setSelectionRange(head, old.length - tail);
    const inserted = next.value.slice(head, next.value.length - tail);
    const done = typeof document.execCommand === "function" && (inserted ? document.execCommand("insertText", false, inserted) : document.execCommand("delete"));
    if (done && el.value === next.value) {
      el.setSelectionRange(next.start, next.end);
    } else {
      pending.current = { start: next.start, end: next.end };
      onChange(next.value);
    }
  }

  const state = (): EditState => ({ value: area.current?.value ?? value, start: area.current?.selectionStart ?? 0, end: area.current?.selectionEnd ?? 0 });

  /** Runs a formatting action on the textarea's current selection. */
  function command(action: Action) {
    const s = state();
    switch (action) {
      case "heading": return apply(toggleLinePrefix(s, "# "));
      case "bold": return apply(wrapSelection(s, "**", "**", t("bold").toLowerCase()));
      case "italic": return apply(wrapSelection(s, "*", "*", t("italic").toLowerCase()));
      case "strike": return apply(wrapSelection(s, "~~", "~~", t("strikethrough").toLowerCase()));
      case "code": return apply(wrapSelection(s, "`", "`", "code"));
      case "link": return apply(insertLink(s));
      case "quote": return apply(toggleLinePrefix(s, "> "));
      case "bullets": return apply(toggleLinePrefix(s, "- "));
      case "numbers": return apply(toggleLinePrefix(s, "1. "));
      case "tasks": return apply(toggleLinePrefix(s, "- [ ] "));
      case "codeBlock": return apply(insertBlock(s, `\`\`\`\n${s.value.slice(s.start, s.end)}\n\`\`\``));
      case "rule": return apply(insertBlock({ ...s, end: s.start }, "---"));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && (key === "b" || key === "i" || key === "k")) {
      e.preventDefault();
      command(key === "b" ? "bold" : key === "i" ? "italic" : "link");
    } else if (mod && e.shiftKey && (e.code === "Digit7" || e.code === "Digit8")) {
      e.preventDefault();
      command(e.code === "Digit7" ? "numbers" : "bullets");
    } else if (e.key === "Enter" && !e.shiftKey && !mod && !e.altKey && !e.nativeEvent.isComposing) {
      const next = continueList(state());
      if (next) {
        e.preventDefault();
        apply(next);
      }
    } else if (e.key === "Tab" && !mod && !e.altKey && touchesList(state())) {
      e.preventDefault();
      apply(indentLines(state(), e.shiftKey));
    }
  }

  const rows = minRows ?? (compact ? 4 : 8);
  const tools: { key: string; label: string; icon: ReactNode; action?: Action; keys?: string }[] = [
    { key: "heading", label: t("heading"), icon: <Heading />, action: "heading" },
    { key: "bold", label: t("bold"), icon: <Bold />, action: "bold", keys: "Ctrl+B" },
    { key: "italic", label: t("italic"), icon: <Italic />, action: "italic", keys: "Ctrl+I" },
    { key: "strike", label: t("strikethrough"), icon: <Strikethrough />, action: "strike" },
    { key: "code", label: t("code"), icon: <Code />, action: "code" },
    { key: "link", label: t("link"), icon: <Link />, action: "link", keys: "Ctrl+K" },
    { key: "sep1", label: "", icon: null },
    { key: "quote", label: t("quote"), icon: <Quote />, action: "quote" },
    { key: "bullets", label: t("bulletList"), icon: <List />, action: "bullets", keys: "Ctrl+Shift+8" },
    { key: "numbers", label: t("numberedList"), icon: <ListOrdered />, action: "numbers", keys: "Ctrl+Shift+7" },
    { key: "tasks", label: t("taskList"), icon: <ListChecks />, action: "tasks" },
    { key: "sep2", label: "", icon: null },
    { key: "codeBlock", label: t("codeBlock"), icon: <FileCode />, action: "codeBlock" },
    { key: "rule", label: t("rule"), icon: <Minus />, action: "rule" },
  ];
  const modes: Mode[] = compact ? ["write", "preview"] : ["write", "preview", "split"];
  const showWrite = mode !== "preview";
  const showPreview = mode !== "write";

  return (
    <TooltipProvider>
      <div className="flex flex-col border bg-card">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5">
          <div role="group" aria-label={t("viewLabel")} className="flex">
            {modes.map((m) => (
              <Button
                key={m}
                type="button"
                size={compact ? "xs" : "sm"}
                variant={mode === m ? "secondary" : "ghost"}
                aria-pressed={mode === m}
                className={m === "split" ? "max-lg:hidden" : undefined}
                onClick={() => setMode(m)}
              >
                {t(m)}
              </Button>
            ))}
          </div>
          {showWrite && (
            <div role="toolbar" aria-label={t("toolbarLabel")} className="flex flex-wrap items-center gap-0.5">
              {tools.map((tool) =>
                tool.icon ? (
                  <Tooltip key={tool.key}>
                    <TooltipTrigger asChild>
                      <Button type="button" size={compact ? "icon-xs" : "icon-sm"} variant="ghost" aria-label={tool.label} disabled={disabled} onClick={() => tool.action && command(tool.action)}>
                        {tool.icon}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {tool.label}
                      {tool.keys && <Kbd className="ml-1.5">{tool.keys}</Kbd>}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Separator key={tool.key} orientation="vertical" className="mx-1 h-4" />
                ),
              )}
              {extraTools && (
                <>
                  <Separator orientation="vertical" className="mx-1 h-4" />
                  {extraTools}
                </>
              )}
            </div>
          )}
        </div>
        <div className={showWrite && showPreview ? "grid lg:grid-cols-2 lg:divide-x" : undefined}>
          {showWrite && (
            <Textarea
              ref={area}
              id={id}
              aria-label={ariaLabel}
              className="max-h-[70vh] rounded-none border-0 font-mono text-[13px] leading-6 focus-visible:ring-0"
              style={{ minHeight: `${rows * 1.5}rem` }}
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
          )}
          {showPreview && (
            <div className={`max-h-[70vh] overflow-auto px-4 py-3 ${showWrite ? "max-lg:hidden" : ""}`} style={{ minHeight: `${rows * 1.5}rem` }}>
              {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>}
            </div>
          )}
        </div>
        {(footer || maxLength !== undefined) && (
          <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
            <div className="min-w-0">{footer}</div>
            {maxLength !== undefined && <span className="ml-auto tabular-nums">{t("counter", { count: value.length, max: maxLength })}</span>}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
