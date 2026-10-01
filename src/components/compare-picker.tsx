"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Pushes the current URL with `edit` applied to its search parameters. */
function useSearchEdit() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (edit: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(search);
    edit(next);
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
}

/**
 * A "Read / Compare" segmented control. Compare sets `compare=<latest-1>..<latest>`
 * and drops the version parameter; Read removes `compare`.
 *
 * @param props.param the search parameter that selects the version
 * @param props.versions all version numbers, newest first
 * @param props.comparing whether the diff is shown
 */
export function CompareToggle({ param, versions, comparing }: { param: string; versions: number[]; comparing: boolean }) {
  const edit = useSearchEdit();
  return (
    <div role="group" aria-label="Document view" className="flex">
      <Button
        variant={comparing ? "outline" : "secondary"}
        size="sm"
        aria-pressed={!comparing}
        onClick={() => edit((p) => p.delete("compare"))}
      >
        Read
      </Button>
      <Button
        variant={comparing ? "secondary" : "outline"}
        size="sm"
        aria-pressed={comparing}
        onClick={() =>
          edit((p) => {
            p.delete(param);
            p.set("compare", `${versions[1]}..${versions[0]}`);
          })
        }
      >
        Compare
      </Button>
    </div>
  );
}

/**
 * Two selects, from and to, that set the `compare` parameter. Each lists only
 * versions that keep the range valid (from lower than to).
 *
 * @param props.versions all version numbers, newest first
 */
export function CompareSelects({ versions, from, to }: { versions: number[]; from: number; to: number }) {
  const edit = useSearchEdit();
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <label className="flex items-center gap-1.5">
        From
        <NativeSelect size="sm" value={from} onChange={(e) => edit((p) => p.set("compare", `${e.target.value}..${to}`))}>
          {versions
            .filter((v) => v < to)
            .map((v) => (
              <NativeSelectOption key={v} value={v}>
                v{v}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </label>
      <label className="flex items-center gap-1.5">
        To
        <NativeSelect size="sm" value={to} onChange={(e) => edit((p) => p.set("compare", `${from}..${e.target.value}`))}>
          {versions
            .filter((v) => v > from)
            .map((v) => (
              <NativeSelectOption key={v} value={v}>
                v{v}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </label>
    </div>
  );
}
