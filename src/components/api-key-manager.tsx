"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/settings/api-keys/actions";
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
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** An API key row as the page passes it in, with dates as ISO strings. */
export interface ApiKeyItem {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastRequest: string | null;
}

/** Lists the user's keys, creates new ones (shown once with the env lines) and revokes them. */
export function ApiKeyManager({ keys, appUrl }: { keys: ApiKeyItem[]; appUrl: string }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const envLines = created ? `ROADMAP_URL=${appUrl}\nROADMAP_API_KEY=${created}` : "";

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <Card>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await createApiKeyAction({ name, expiresInDays: days ? Number(days) : null });
                if (!result.ok) return void toast.error(result.error);
                setCreated(result.value.key);
                setName("");
                setDays("");
              });
            }}
          >
            <Input
              id="key-name"
              aria-label="Key name"
              placeholder="Name, e.g. laptop"
              maxLength={32}
              className="min-w-40 flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              id="key-days"
              aria-label="Expires after days (empty for never)"
              placeholder="Expires in days (optional)"
              type="number"
              min={1}
              max={365}
              className="w-56"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <Button type="submit" disabled={pending || !name.trim()}>
              Create key
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>Copy these lines now. The key is not shown again.</DialogDescription>
          </DialogHeader>
          <pre className="rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{envLines}</pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(envLines);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent>
          {keys.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No keys yet</EmptyTitle>
                <EmptyDescription>Create one for the surf-roadmap plugin or a script.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Starts with</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name ?? "unnamed"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{k.start ? `${k.start}…` : ""}</TableCell>
                    <TableCell>{k.createdAt.slice(0, 10)}</TableCell>
                    <TableCell>{k.expiresAt ? k.expiresAt.slice(0, 10) : "never"}</TableCell>
                    <TableCell>{k.lastRequest ? k.lastRequest.slice(0, 10) : "never"}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={pending}>
                            Revoke
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke {k.name ?? "this key"}?</AlertDialogTitle>
                            <AlertDialogDescription>Anything using it stops working immediately.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await revokeApiKeyAction(k.id);
                                  if (result.ok) toast.success("Key revoked");
                                  else toast.error(result.error);
                                })
                              }
                            >
                              Revoke
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
