"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Asks a project owner whether to move a system past unmet column rules. Open while
 * `message` (the server's refusal) is set; "Move anyway" is enabled once a reason is typed.
 */
export function MoveOverrideDialog({
  message,
  pending,
  onConfirm,
  onCancel,
}: {
  message: string | null;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 3;
  return (
    <AlertDialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move anyway?</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea aria-label="Reason for moving anyway" placeholder="Why move it anyway?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || pending}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            Move anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
