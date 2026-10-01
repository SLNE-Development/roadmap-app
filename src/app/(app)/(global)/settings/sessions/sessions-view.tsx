"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Laptop } from "lucide-react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { Page, PageHeader, Panel } from "@/components/page";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { plural } from "@/lib/text";
import { formatDate, relativeAge } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** The sessions page body: where the user is signed in, with sign-out per device and for all other devices. */
export function SessionsView() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.account.sessions.queryOptions());
  const now = useNow();
  const end = useMutation(trpc.account.endSession.mutationOptions({ onSuccess: () => toast.success("Signed out") }));
  const endOthers = useMutation(
    trpc.account.endOtherSessions.mutationOptions({ onSuccess: ({ ended }) => toast.success(`Signed out ${plural(ended, "device")}`) }),
  );
  const pending = end.isPending || endOthers.isPending;
  const others = data.filter((s) => !s.current).length;
  return (
    <Page width="medium">
      <PageHeader crumbs={[{ label: "Account" }]} title="Sessions" description="The devices where you are signed in. Signing a device out takes effect at once." />
      <div className="flex flex-col gap-5" aria-busy={pending}>
        <Panel
          title="Signed in"
          meta={plural(data.length, "session")}
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending || others === 0}>
                  Sign out all other devices
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out all other devices?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {plural(others, "other device")} will be signed out immediately. This device stays signed in.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => endOthers.mutate()}>Sign out all other devices</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">Device</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">IP</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">Signed in</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground">Last active</TableHead>
                <TableHead className="pr-4 sm:pr-5">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="py-2.5 pl-4 font-semibold sm:pl-5">
                    <span className="inline-flex items-center gap-2">
                      <Laptop className="size-4 text-fg-2" aria-hidden />
                      {s.device}
                      {s.current && <span className="bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-fg-2">This device</span>}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-fg-2">{s.ip ?? ""}</TableCell>
                  <TableCell className="text-fg-2">{formatDate(s.createdAt.toISOString(), now)}</TableCell>
                  <TableCell className="text-fg-2">{relativeAge(s.lastActiveAt.toISOString(), now)}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap sm:pr-5">
                    {s.current ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={pending}
                        aria-label={`Sign out ${s.device}`}
                        onClick={() => end.mutate({ id: s.id })}
                      >
                        Sign out
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </Page>
  );
}
