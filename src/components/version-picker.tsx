"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Chooses which version of a document to show by setting the `param` search parameter. */
export function VersionPicker({ param, versions, current }: { param: string; versions: number[]; current: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <NativeSelect
      size="sm"
      aria-label="Version"
      value={String(current)}
      onChange={(e) => {
        const next = new URLSearchParams(search);
        if (Number(e.target.value) === versions[0]) next.delete(param);
        else next.set(param, e.target.value);
        router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
      }}
    >
      {versions.map((v, i) => (
        <NativeSelectOption key={v} value={String(v)}>
          v{v}
          {i === 0 ? " (latest)" : ""}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
