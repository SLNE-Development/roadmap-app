"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * A square button with the shown version that opens a menu of all versions;
 * choosing one sets the `param` search parameter (removed for the latest).
 */
export function VersionPicker({ param, versions, current }: { param: string; versions: number[]; current: number }) {
  const t = useTranslations("documents.versions");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const latest = versions[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("choose", { version: current })}>
          {`v${current}`}
          {current === latest && <span className="font-normal text-muted-foreground">{t("latest")}</span>}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={String(current)}
          onValueChange={(v) => {
            const next = new URLSearchParams(search);
            if (Number(v) === latest) next.delete(param);
            else next.set(param, v);
            router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
          }}
        >
          {versions.map((v) => (
            <DropdownMenuRadioItem key={v} value={String(v)}>
              {t("version", { version: v })}
              {v === latest && <span className="text-muted-foreground">{t("latest")}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
