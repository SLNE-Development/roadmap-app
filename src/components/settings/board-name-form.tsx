"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { updateBoardAction } from "@/app/(app)/p/[project]/actions";
import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The editable name of a board in settings; Save appears once the name changes. Owner only. */
export function BoardNameForm({ projectSlug, boardSlug, name }: { projectSlug: string; boardSlug: string; name: string }) {
  const [value, setValue] = useState(name);
  const { pending, act } = useAction();
  const router = useRouter();
  const trimmed = value.trim();
  const changed = trimmed !== name && trimmed.length > 0;

  return (
    <form
      className="flex min-w-0 flex-1 flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        act(
          () => updateBoardAction(projectSlug, boardSlug, { name: trimmed }),
          () => {
            toast.success("Board renamed");
            router.refresh();
          },
        );
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12.5px] font-semibold text-fg-2">
        Board name
        <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className="font-normal text-foreground" />
      </label>
      {changed && (
        <Button type="submit" disabled={pending}>
          Save name
        </Button>
      )}
    </form>
  );
}
