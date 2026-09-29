"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addAccountAction, removeAccountAction, setAdminAction } from "@/app/(app)/admin/users/actions";
import type { ActionResult } from "@/app/actions/run";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** A provisioned account row as the page passes it in. */
export interface AccountItem {
  discordId: string;
  displayName: string;
  userId: string | null;
  userName: string | null;
  isAdmin: boolean;
}

/** Lists provisioned Discord accounts with admin toggles, removal and a form to add one. */
export function AllowlistManager({ accounts, selfId }: { accounts: AccountItem[]; selfId: string }) {
  const [pending, startTransition] = useTransition();
  const [discordId, setDiscordId] = useState("");
  const [displayName, setDisplayName] = useState("");

  /** Runs an action, toasting its error or `success`, and returns whether it worked. */
  const act = (fn: () => Promise<ActionResult<unknown>>, success?: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
      else {
        if (success) toast.success(success);
        after?.();
      }
    });

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <Card>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = { discordId, displayName };
              act(() => addAccountAction(input), `Added ${input.displayName}`, () => {
                setDiscordId("");
                setDisplayName("");
              });
            }}
          >
            <Input
              id="new-discord-id"
              aria-label="Discord user id"
              placeholder="Discord user id"
              inputMode="numeric"
              className="min-w-48 flex-1 font-mono"
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
            />
            <Input
              id="new-display-name"
              aria-label="Display name"
              placeholder="Display name"
              className="min-w-40 flex-1"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Button type="submit" disabled={pending || !discordId.trim() || !displayName.trim()}>
              Add account
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Discord id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.discordId}>
                  <TableCell className="font-medium">{a.displayName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.discordId}</TableCell>
                  <TableCell>
                    {a.userName ? <Badge variant="secondary">signed in as {a.userName}</Badge> : <Badge variant="outline">not signed in yet</Badge>}
                  </TableCell>
                  <TableCell>
                    {a.userId && (
                      <Checkbox
                        aria-label={`Admin: ${a.displayName}`}
                        checked={a.isAdmin}
                        disabled={pending}
                        onCheckedChange={(checked) => act(() => setAdminAction(a.userId as string, checked === true))}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={pending || a.userId === selfId}>
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {a.displayName}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They are signed out everywhere and their API keys stop working. Their project memberships stay but grant nothing.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => act(() => removeAccountAction(a.discordId), `Removed ${a.displayName}`)}>
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
