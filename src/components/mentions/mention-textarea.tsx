"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { PersonAvatar } from "@/components/person-avatar";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatMention } from "@/lib/mentions";
import { useTRPC } from "@/trpc/client";

/** An `@` (at the start or after a non-word character) followed by letters, right before the caret. */
const QUERY_RE = /(?:^|[^\p{L}\p{N}_])@([\p{L}][\p{L}\p{N}._-]{0,31})$/u;
/** Most members the list shows. */
const MAX_MATCHES = 8;

/** The `@query` right before `caret`, with the index of its `@`, or `null`. */
function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const m = QUERY_RE.exec(value.slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

/**
 * A textarea that suggests project members after `@`. Arrow keys pick, Enter or
 * Tab inserts the mention token and a space, Escape closes the list; the
 * textarea keeps focus throughout.
 *
 * @param props.projectSlug the project whose members are suggested
 * @param props.value the text
 * @param props.onValueChange receives the text after every change, including inserted mentions
 */
export function MentionTextarea({
  projectSlug,
  value,
  onValueChange,
  onChange,
  onKeyDown,
  onSelect,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value"> & { projectSlug: string; value: string; onValueChange: (value: string) => void }) {
  const trpc = useTRPC();
  const ref = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  // The `@` position whose list the user closed with Escape; a new `@` opens again.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const found = mentionQuery(value, Math.min(caret, value.length));
  const query = found && found.start !== dismissed ? found : null;
  const members = useQuery({ ...trpc.notifications.members.queryOptions({ project: projectSlug }), enabled: query !== null, staleTime: 60_000 });
  const needle = query?.query.toLowerCase() ?? "";
  const matches = query
    ? (members.data ?? [])
        .filter((m) => m.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle)) || m.name.toLowerCase().startsWith(needle))
        .slice(0, MAX_MATCHES)
    : [];
  // Back to the first match whenever the query changes (adjusting state while rendering, not in an effect).
  const [lastQuery, setLastQuery] = useState(needle);
  if (lastQuery !== needle) {
    setLastQuery(needle);
    setActive(0);
  }
  const open = query !== null && (matches.length > 0 || members.isPending);
  const picked = matches[Math.min(active, matches.length - 1)];

  // cmdk sets its own ids on the listbox and options (props cannot override them), so the textarea's
  // aria-controls and aria-activedescendant are copied from the rendered list after each render.
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const list = open ? contentRef.current?.querySelector<HTMLElement>("[cmdk-list]") : null;
    const option = list && picked ? list.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(picked.userId)}"]`) : null;
    for (const [name, id] of [["aria-controls", list?.id], ["aria-activedescendant", option?.id]] as const) {
      if (id) textarea.setAttribute(name, id);
      else textarea.removeAttribute(name);
    }
  });

  const insert = (member: { userId: string; name: string }) => {
    if (!query) return;
    const token = `${formatMention(member.name, member.userId)} `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    const at = query.start + token.length;
    onValueChange(next);
    setCaret(at);
    // The new value reaches the DOM on the next render; place the caret after it.
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && matches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (Math.min(i, matches.length - 1) + step + matches.length) % matches.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing && picked) {
        e.preventDefault();
        insert(picked);
        return;
      }
    }
    if (open && e.key === "Escape") {
      // Keeps a surrounding dialog open: Escape only closes the list.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(query.start);
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Textarea
          {...props}
          ref={ref}
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          onChange={(e) => {
            setCaret(e.target.selectionStart);
            onValueChange(e.target.value);
            onChange?.(e);
          }}
          onSelect={(e) => {
            setCaret(e.currentTarget.selectionStart);
            onSelect?.(e);
          }}
          onKeyDown={handleKeyDown}
        />
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        align="start"
        className="w-64 rounded-none p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => query && setDismissed(query.start)}
        onInteractOutside={(e) => {
          if (e.target === ref.current) return;
          if (query) setDismissed(query.start);
        }}
      >
        <Command shouldFilter={false} value={picked?.userId ?? ""} className="rounded-none!">
          <CommandList aria-label="Members">
            {members.isPending ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Loading members…</p>
            ) : (
              <CommandEmpty>No member matches.</CommandEmpty>
            )}
            {matches.map((m) => (
              <CommandItem
                key={m.userId}
                value={m.userId}
                // Keeps focus in the textarea when clicking a member.
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => insert(m)}
                className="rounded-none"
              >
                <PersonAvatar name={m.name} size="xs" />
                <span className="truncate">{m.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
