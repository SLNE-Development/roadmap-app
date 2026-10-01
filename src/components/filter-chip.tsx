"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One choice of a {@link FilterChip}. */
export interface FilterOption {
  value: string;
  label: string;
}

const UNSET = "border border-dashed text-fg-2";
const SET = "border border-primary bg-brand-soft font-medium text-brand-strong";
const FOCUS = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * A filter chip over a list of options: dashed with a chevron while unset, a
 * brand-soft chip with `Label: option` and a clear button while set. It knows
 * nothing about URLs; callers decide what `onChange` does. `""` means unset.
 */
export function FilterChip({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("board.filter");
  const chosen = options.find((o) => o.value === value);
  return (
    <div className={cn("flex h-8 items-center text-[13px]", chosen ? SET : UNSET)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn("flex h-full items-center gap-1.5 px-2.5 hover:text-foreground", chosen && "pr-1.5", FOCUS)}>
            {chosen ? `${label}: ${chosen.label}` : label}
            {!chosen && <ChevronDown aria-hidden className="size-3" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-auto min-w-44">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">{t("nothing")}</p>
          ) : (
            <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
              <DropdownMenuRadioItem value="">{t("any")}</DropdownMenuRadioItem>
              {options.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {chosen && (
        <button
          type="button"
          aria-label={t("clearOne", { label })}
          onClick={() => onChange("")}
          className={cn("flex h-full items-center pr-2 pl-0.5 hover:text-foreground", FOCUS)}
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
    </div>
  );
}

/** A toggle chip (such as "Agents only") with the same set and unset looks as {@link FilterChip}. */
export function ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn("flex h-8 items-center gap-1.5 px-2.5 text-[13px] hover:text-foreground", on ? SET : UNSET, FOCUS)}
    >
      {on && <Check aria-hidden className="size-3.5" />}
      {label}
    </button>
  );
}
