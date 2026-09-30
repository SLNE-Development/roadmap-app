"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { addAccountAction, removeAccountAction, setAdminAction } from "@/app/(app)/(global)/admin/users/actions";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Tag } from "./chips";
import { EmptyState, Panel } from "./page";
import { PersonAvatar } from "./person-avatar";
import { useAction } from "./use-action";

/** A provisioned account row as the page passes it in. */
export interface AccountItem {
  discordId: string;
  displayName: string;
  userId: string | null;
  userName: string | null;
  isAdmin: boolean;
}

/** Header cell style of the accounts table. */
const HEAD = "text-xs font-semibold text-muted-foreground";

/** Lists provisioned Discord accounts with admin toggles, removal and a form to add one. */
export function AllowlistManager({ accounts, selfId }: { accounts: AccountItem[]; selfId: string }) {
  const { pending, act } = useAction();
  const [discordId, setDiscordId] = useState("");
  const [displayName, setDisplayName] = useState("");

  return (
    <div className="flex flex-col gap-5" aria-busy={pending}>
      <Panel title="Add an account" bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { discordId: discordId.trim(), displayName: displayName.trim() };
            act(
              () => addAccountAction(input),
              () => {
                toast.success(`Added ${input.displayName}`);
                setDiscordId("");
                setDisplayName("");
              },
            );
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-discord-id" className="text-[12.5px] font-semibold text-fg-2">
              Discord user id
            </Label>
            <Input
              id="new-discord-id"
              inputMode="numeric"
              aria-describedby="new-discord-id-hint"
              className="font-mono"
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
            />
            <p id="new-discord-id-hint" className="text-xs text-muted-foreground">
              In Discord with Developer Mode on: right-click the user, Copy User ID.
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-display-name" className="text-[12.5px] font-semibold text-fg-2">
              Display name
            </Label>
            <Input id="new-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button type="submit" className="sm:mt-[23px]" disabled={pending || !discordId.trim() || !displayName.trim()}>
            Add account
          </Button>
        </form>
      </Panel>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title="No accounts yet"
          description="Add a Discord user id above so that person can sign in."
        />
      ) : (
        <Panel title="Allowlist" meta={accounts.length === 1 ? "1 account" : `${accounts.length} accounts`}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(HEAD, "pl-4 sm:pl-5")}>Name</TableHead>
                <TableHead className={HEAD}>Discord id</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
                <TableHead className={HEAD}>Admin</TableHead>
                <TableHead className="pr-4 sm:pr-5">
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const self = a.userId === selfId;
                const adminId = `admin-${a.discordId}`;
                return (
                  <TableRow key={a.discordId}>
                    <TableCell className="py-2.5 pl-4 sm:pl-5">
                      <span className="flex items-center gap-2 font-semibold">
                        <PersonAvatar name={a.displayName} className={cn(!a.userId && "opacity-40 grayscale")} />
                        {a.displayName}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{a.discordId}</TableCell>
                    <TableCell>
                      {a.userName ? (
                        <Tag className="bg-cat-done-soft font-semibold text-cat-done">Signed in as {a.userName}</Tag>
                      ) : (
                        <Tag>Not signed in yet</Tag>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.userId && (
                        <span className="flex items-center gap-2">
                          <Checkbox
                            id={adminId}
                            checked={a.isAdmin}
                            disabled={pending || self}
                            onCheckedChange={(checked) =>
                              act(
                                () => setAdminAction(a.userId as string, checked === true),
                                () => toast.success(checked === true ? `${a.displayName} is now an admin` : `${a.displayName} is no longer an admin`),
                              )
                            }
                          />
                          <Label htmlFor={adminId} className={cn("text-[13px] font-normal", self && "text-muted-foreground")}>
                            Admin{self && " (you)"}
                          </Label>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right sm:pr-5">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${a.displayName}`}
                            className="text-muted-foreground hover:text-destructive"
                            disabled={pending || self}
                          >
                            <Trash2 aria-hidden />
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
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => act(() => removeAccountAction(a.discordId), () => toast.success(`Removed ${a.displayName}`))}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
