"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/actions/run";

/**
 * Returns a pending flag and an `act` function that runs a server action in a
 * transition, toasts its error on failure and calls `after` on success.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const act = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
      else after?.();
    });
  return { pending, act };
}
