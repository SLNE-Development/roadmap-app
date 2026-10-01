"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { PRIORITIES } from "@/db/schema";
import { plural } from "@/lib/text";
import { useTRPC } from "@/trpc/client";

/** The value of the option that clears an owner, phase or domain. */
const NONE = "__none";

/**
 * The sticky bar for editing the selected systems: each dropdown applies its
 * value to every selected system at once.
 *
 * @param props.slug the project slug
 * @param props.systems slugs of the selected systems
 * @param props.onDone called after a successful update, to clear the selection
 * @param props.onClear called by the Clear button
 */
export function BulkBar({
  slug,
  systems,
  owners,
  phases,
  domains,
  boards,
  onDone,
  onClear,
}: {
  slug: string;
  systems: string[];
  owners: { id: string; name: string }[];
  phases: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  boards: { slug: string; name: string; columns: { id: string; name: string }[] }[];
  onDone: () => void;
  onClear: () => void;
}) {
  const trpc = useTRPC();
  const bulk = useMutation(
    trpc.systems.bulkUpdate.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Updated ${plural(result.updated.length, "system")}`);
        onDone();
      },
    }),
  );
  const apply = (patch: Parameters<typeof bulk.mutate>[0]["patch"]) => bulk.mutate({ project: slug, systems, patch });
  const id = (value: string) => (value === NONE ? null : value);
  // Controlled at "" so the placeholder shows again after every choice.
  const select = (label: string, onPick: (value: string) => void, children: React.ReactNode) => (
    <NativeSelect size="sm" aria-label={label} value="" disabled={bulk.isPending} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <NativeSelectOption value="">{label}</NativeSelectOption>
      {children}
    </NativeSelect>
  );
  return (
    <div
      role="region"
      aria-label="Bulk edit"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 border bg-card px-3 py-2 shadow-lg"
    >
      <span className="text-[13px] font-semibold">{systems.length} selected</span>
      {select(
        "Owner",
        (v) => apply({ ownerUserId: id(v) }),
        <>
          <NativeSelectOption value={NONE}>Unowned</NativeSelectOption>
          {owners.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.name}
            </NativeSelectOption>
          ))}
        </>,
      )}
      {select(
        "Phase",
        (v) => apply({ phaseId: id(v) }),
        <>
          <NativeSelectOption value={NONE}>No phase</NativeSelectOption>
          {phases.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </>,
      )}
      {select(
        "Domain",
        (v) => apply({ domainId: id(v) }),
        <>
          <NativeSelectOption value={NONE}>No domain</NativeSelectOption>
          {domains.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {d.name}
            </NativeSelectOption>
          ))}
        </>,
      )}
      {select(
        "Priority",
        (v) => apply({ priority: v as (typeof PRIORITIES)[number] }),
        PRIORITIES.map((p) => (
          <NativeSelectOption key={p} value={p}>
            {p}
          </NativeSelectOption>
        )),
      )}
      {select(
        "Move to",
        (v) => {
          const [boardSlug, column] = v.split("/");
          apply({ move: { board: boardSlug, column } });
        },
        boards.map((b) => (
          <NativeSelectOptGroup key={b.slug} label={b.name}>
            {b.columns.map((c) => (
              <NativeSelectOption key={c.id} value={`${b.slug}/${c.id}`}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        )),
      )}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
