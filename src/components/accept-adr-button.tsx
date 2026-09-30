"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { acceptAdrAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";

/** Accepts a proposed ADR. */
export function AcceptAdrButton({ projectSlug, number }: { projectSlug: string; number: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await acceptAdrAction(projectSlug, number);
          if (result.ok) toast.success("ADR accepted");
          else toast.error(result.error);
        })
      }
    >
      Accept
    </Button>
  );
}
