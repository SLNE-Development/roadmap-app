"use client";

import { useMutation } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { EmptyState, Panel } from "./page";

/** An API key row as the page view passes it in, with dates already formatted. */
export interface ApiKeyItem {
  id: string;
  name: string | null;
  start: string | null;
  /** Creation date, e.g. "12 Sep". */
  created: string;
  /** Expiry date, "Expired 12 Sep", or "Never". */
  expires: string;
  /** How close the expiry is; `soon` is within seven days. */
  expiry: "none" | "later" | "soon" | "expired";
  /** Last use as a relative age, or "Never". */
  lastUsed: string;
}

/** Choices of the Expires select, in days; empty means the key never expires. */
const EXPIRY_OPTIONS = [
  { value: "", label: "Never" },
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In 365 days" },
];

/** Text class of an expiry cell by how close it is. */
const EXPIRY_CLASS: Record<ApiKeyItem["expiry"], string> = {
  none: "text-fg-2",
  later: "text-fg-2",
  soon: "font-semibold text-cat-review",
  expired: "font-semibold text-destructive",
};

/** Lists the user's keys, creates new ones (shown once with the env lines in a dialog) and revokes them. */
export function ApiKeyManager({ keys, appUrl }: { keys: ApiKeyItem[]; appUrl: string }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.account.createApiKey.mutationOptions());
  // The toast lives on the hook: the revoked key's row (with its dialog) is gone once the refetch settles.
  const revoke = useMutation(trpc.account.revokeApiKey.mutationOptions({ onSuccess: () => toast.success("Key revoked") }));
  const pending = create.isPending || revoke.isPending;
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);

  const envLines = created ? `ROADMAP_URL=${appUrl}\nROADMAP_API_KEY=${created}` : "";

  return (
    <div className="flex flex-col gap-5" aria-busy={pending}>
      <Panel title="Create a key" bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { name, expiresInDays: days ? Number(days) : null },
              {
                onSuccess: ({ key }) => {
                  setCreated(key);
                  setName("");
                },
              },
            );
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="key-name" className="text-[12.5px] font-semibold text-fg-2">
              Name
            </Label>
            <Input id="key-name" placeholder="e.g. work laptop" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:w-44">
            <Label htmlFor="key-expires" className="text-[12.5px] font-semibold text-fg-2">
              Expires
            </Label>
            <NativeSelect id="key-expires" className="w-full" value={days} onChange={(e) => setDays(e.target.value)}>
              {EXPIRY_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" disabled={pending || !name.trim()}>
            Create key
          </Button>
        </form>
      </Panel>

      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new key</DialogTitle>
            <DialogDescription>
              This is the only time the key is shown. Set these two lines as environment variables for the surf-roadmap plugin.
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-secondary p-3 font-mono text-[12.5px] leading-[1.7] break-all whitespace-pre-wrap">{envLines}</pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envLines);
                  toast.success("Copied");
                } catch {
                  toast.error("Copying failed. Select the lines and copy them by hand.");
                }
              }}
            >
              <Copy aria-hidden />
              Copy
            </Button>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title="No API keys yet"
          description="Agents such as the surf-roadmap plugin use a key to read and update your projects over MCP and REST. Create one above."
        />
      ) : (
        <Panel title="Keys" meta={keys.length === 1 ? "1 key" : `${keys.length} keys`}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">Name</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">Key</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">Created</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">Expires</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">Last used</TableHead>
                <TableHead className="pr-4 sm:pr-5">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="py-2.5 pl-4 font-semibold sm:pl-5">{k.name ?? "Unnamed key"}</TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-2">{k.start ? `${k.start}…` : ""}</TableCell>
                  <TableCell className="text-fg-2">{k.created}</TableCell>
                  <TableCell className={cn(EXPIRY_CLASS[k.expiry])}>{k.expires}</TableCell>
                  <TableCell className="text-fg-2">{k.lastUsed}</TableCell>
                  <TableCell className="pr-4 text-right sm:pr-5">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={pending}>
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
                            onClick={() => revoke.mutate({ id: k.id })}
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
        </Panel>
      )}
    </div>
  );
}
