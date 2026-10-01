"use client";

import { useMutation } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
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
  /** Calls per UTC day over the last 7 days (oldest first) and 30-day totals. */
  usage: { last7Days: number[]; total30Days: number; errors30Days: number };
  /** "expires in 24 h" while a rotated-out key is still in its grace period, else null. */
  grace: string | null;
}

/** Choices of the Expires select, in days; empty means the key never expires. */
const EXPIRY_OPTIONS = [
  { value: "", days: 0 },
  { value: "30", days: 30 },
  { value: "90", days: 90 },
  { value: "365", days: 365 },
];

/** Text class of an expiry cell by how close it is. */
const EXPIRY_CLASS: Record<ApiKeyItem["expiry"], string> = {
  none: "text-fg-2",
  later: "text-fg-2",
  soon: "font-semibold text-cat-review",
  expired: "font-semibold text-destructive",
};

/** Seven bars of calls per day, drawn to scale from 0 to the key's busiest day. */
function SparkBars({ counts }: { counts: number[] }) {
  const t = useTranslations("account.apiKeys");
  const max = Math.max(...counts, 1);
  return (
    <svg width="42" height="16" viewBox="0 0 42 16" role="img" aria-label={t("callsPerDay", { counts: counts.join(", ") })} className="shrink-0 text-fg-2">
      {counts.map((n, i) => {
        const h = n === 0 ? 1 : Math.max(2, (n / max) * 16);
        return <rect key={i} x={i * 6} y={16 - h} width="4" height={h} fill="currentColor" opacity={n === 0 ? 0.35 : 1} />;
      })}
    </svg>
  );
}

/** Lists the user's keys, creates new ones (shown once with the env lines in a dialog), rotates and revokes them. */
export function ApiKeyManager({ keys, appUrl }: { keys: ApiKeyItem[]; appUrl: string }) {
  const t = useTranslations("account.apiKeys");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const create = useMutation(trpc.account.createApiKey.mutationOptions());
  // The toast lives on the hook: the revoked key's row (with its dialog) is gone once the refetch settles.
  const revoke = useMutation(trpc.account.revokeApiKey.mutationOptions({ onSuccess: () => toast.success(t("revoked")) }));
  const rotate = useMutation(trpc.account.rotateApiKey.mutationOptions());
  const pending = create.isPending || revoke.isPending || rotate.isPending;
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);

  const envLines = created ? `ROADMAP_URL=${appUrl}\nROADMAP_API_KEY=${created}` : "";

  return (
    <div className="flex flex-col gap-5" aria-busy={pending}>
      <Panel title={t("createTitle")} bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5">
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
              {t("name")}
            </Label>
            <Input id="key-name" placeholder={t("namePlaceholder")} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:w-44">
            <Label htmlFor="key-expires" className="text-[12.5px] font-semibold text-fg-2">
              {t("expires")}
            </Label>
            <NativeSelect id="key-expires" className="w-full" value={days} onChange={(e) => setDays(e.target.value)}>
              {EXPIRY_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.days ? t("inDays", { days: o.days }) : t("never")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" disabled={pending || !name.trim()}>
            {t("createKey")}
          </Button>
        </form>
      </Panel>

      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("copyTitle")}</DialogTitle>
            <DialogDescription>{t("copyDescription")}</DialogDescription>
          </DialogHeader>
          <pre className="bg-secondary p-3 font-mono text-[12.5px] leading-[1.7] break-all whitespace-pre-wrap">{envLines}</pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envLines);
                  toast.success(tc("copied"));
                } catch {
                  toast.error(t("copyFailed"));
                }
              }}
            >
              <Copy aria-hidden />
              {tc("copy")}
            </Button>
            <Button onClick={() => setCreated(null)}>{tc("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Panel title={t("keysTitle")} meta={t("keyCount", { count: keys.length })}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">{t("name")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("key")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("created")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("expires")}</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">{t("usage")}</TableHead>
                <TableHead className="pr-4 sm:pr-5">
                  <span className="sr-only">{t("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="py-2.5 pl-4 font-semibold sm:pl-5">{k.name ?? t("unnamedKey")}</TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-2">{k.start ? `${k.start}…` : ""}</TableCell>
                  <TableCell className="text-fg-2">{k.created}</TableCell>
                  <TableCell className={cn(EXPIRY_CLASS[k.expiry], k.grace && "font-semibold text-cat-review")}>{k.grace ?? k.expires}</TableCell>
                  <TableCell className="text-fg-2">
                    <div className="flex items-center gap-2">
                      <SparkBars counts={k.usage.last7Days} />
                      <div className="flex flex-col text-[12.5px] leading-snug">
                        <span>{t("lastUsed", { when: k.lastUsed })}</span>
                        <span>{t("usage30Days", { calls: k.usage.total30Days, errors: k.usage.errors30Days })}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap sm:pr-5">
                    {k.grace ? null : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="mr-2" disabled={pending}>
                            {t("rotate")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{k.name ? t("rotateTitle", { name: k.name }) : t("rotateTitleThis")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("rotateDescription")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => rotate.mutate({ id: k.id }, { onSuccess: ({ key }) => setCreated(key) })}>
                              {t("rotate")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={pending}>
                          {k.grace ? t("revokeNow") : t("revoke")}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{k.name ? t("revokeTitle", { name: k.name }) : t("revokeTitleThis")}</AlertDialogTitle>
                          <AlertDialogDescription>{t("revokeDescription")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => revoke.mutate({ id: k.id })}
                          >
                            {t("revoke")}
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
