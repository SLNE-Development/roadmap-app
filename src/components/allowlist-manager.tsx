"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Tag } from "./chips";
import { EmptyState, Panel } from "./page";
import { PersonAvatar } from "./person-avatar";

/** A provisioned account row as the page passes it in. */
export interface AccountItem {
  discordId: string;
  displayName: string;
  userId: string | null;
  userName: string | null;
  isAdmin: boolean;
  isEventManager: boolean;
  isEventDeveloper: boolean;
}

/** Header cell style of the accounts table. */
const HEAD = "text-xs font-semibold text-muted-foreground";

/** Lists provisioned Discord accounts with admin toggles, removal and a form to add one. */
export function AllowlistManager({ accounts, selfId }: { accounts: AccountItem[]; selfId: string }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const add = useMutation(trpc.account.addAccount.mutationOptions());
  // The toast lives on the hook: the removed account's row (with its dialog) is gone once the refetch settles.
  const remove = useMutation(
    trpc.account.removeAccount.mutationOptions({
      onMutate: ({ discordId }) => accounts.find((a) => a.discordId === discordId)?.displayName,
      onSuccess: (_data, _input, name) => toast.success(name ? t("removed", { name }) : t("removedAccount")),
    }),
  );
  const setAdmin = useMutation(trpc.account.setAdmin.mutationOptions());
  const setEventRole = useMutation(trpc.admin.setEventRole.mutationOptions());
  const pending = add.isPending || remove.isPending || setAdmin.isPending || setEventRole.isPending;
  const [discordId, setDiscordId] = useState("");
  const [displayName, setDisplayName] = useState("");

  return (
    <div className="flex flex-col gap-5" aria-busy={pending}>
      <Panel title={t("addTitle")} bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { discordId: discordId.trim(), displayName: displayName.trim() };
            add.mutate(input, {
              onSuccess: () => {
                toast.success(t("added", { name: input.displayName }));
                setDiscordId("");
                setDisplayName("");
              },
            });
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-discord-id" className="text-[12.5px] font-semibold text-fg-2">
              {t("discordId")}
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
              {t("discordIdHint")}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-display-name" className="text-[12.5px] font-semibold text-fg-2">
              {t("displayName")}
            </Label>
            <Input id="new-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button type="submit" className="sm:mt-[23px]" disabled={pending || !discordId.trim() || !displayName.trim()}>
            {t("addAccount")}
          </Button>
        </form>
      </Panel>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Panel title={t("allowlistTitle")} meta={t("accountCount", { count: accounts.length })}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(HEAD, "pl-4 sm:pl-5")}>{t("name")}</TableHead>
                <TableHead className={HEAD}>{t("discordIdShort")}</TableHead>
                <TableHead className={HEAD}>{t("status")}</TableHead>
                <TableHead className={HEAD}>{t("admin")}</TableHead>
                <TableHead className={HEAD}>{t("eventRoles")}</TableHead>
                <TableHead className="pr-4 sm:pr-5">
                  <span className="sr-only">{tc("remove")}</span>
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
                        <Tag className="bg-cat-done-soft font-semibold text-cat-done">{t("signedInAs", { name: a.userName })}</Tag>
                      ) : (
                        <Tag>{t("notSignedIn")}</Tag>
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
                              setAdmin.mutate(
                                { userId: a.userId as string, isAdmin: checked === true },
                                {
                                  onSuccess: () =>
                                    toast.success(checked === true ? t("nowAdmin", { name: a.displayName }) : t("noLongerAdmin", { name: a.displayName })),
                                },
                              )
                            }
                          />
                          <Label htmlFor={adminId} className={cn("text-[13px] font-normal", self && "text-muted-foreground")}>
                            {self ? t("adminYou") : t("admin")}
                          </Label>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.userId && (
                        <span className="flex flex-col gap-1.5">
                          {(["manager", "developer"] as const).map((role) => {
                            const id = `event-${role}-${a.discordId}`;
                            const on = role === "manager" ? a.isEventManager : a.isEventDeveloper;
                            return (
                              <span key={role} className="flex items-center gap-2">
                                <Switch
                                  id={id}
                                  size="sm"
                                  checked={on}
                                  disabled={pending}
                                  onCheckedChange={(checked) =>
                                    setEventRole.mutate({ userId: a.userId as string, role, value: checked })
                                  }
                                />
                                <Label htmlFor={id} className="text-[13px] font-normal">
                                  {t(role === "manager" ? "eventManager" : "eventDeveloper")}
                                </Label>
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right sm:pr-5">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("removeName", { name: a.displayName })}
                            className="text-muted-foreground hover:text-destructive"
                            disabled={pending || self}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("removeTitle", { name: a.displayName })}</AlertDialogTitle>
                            <AlertDialogDescription>{t("removeDescription")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                remove.mutate({ discordId: a.discordId })
                              }
                            >
                              {tc("remove")}
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
