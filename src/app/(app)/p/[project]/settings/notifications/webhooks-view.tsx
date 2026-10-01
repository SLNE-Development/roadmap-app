"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { PencilIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_DISCORD_EVENTS, DISCORD_EVENT_LABEL, DISCORD_EVENTS, type DiscordEvent } from "@/lib/discord-events";
import type { WebhookItem } from "@/lib/ops/webhooks";
import { relativeAge } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** A board a webhook can be limited to. */
interface BoardOption {
  id: string;
  name: string;
}

/**
 * The add and edit form of a webhook. When editing, an empty URL keeps the stored one, which the browser never sees.
 * Mounted fresh each time its dialog opens, so its state starts from `initial`.
 */
function WebhookForm({ slug, boards, initial, onDone }: { slug: string; boards: BoardOption[]; initial: WebhookItem | null; onDone: () => void }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.webhooks.create.mutationOptions());
  const update = useMutation(trpc.webhooks.update.mutationOptions());
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Set<string>>(() => new Set(initial?.events ?? DEFAULT_DISCORD_EVENTS));
  // Boards deleted since the webhook was saved drop out of the selection.
  const [boardIds, setBoardIds] = useState<Set<string>>(() => new Set((initial?.boardIds ?? []).filter((id) => boards.some((b) => b.id === id))));
  const [digest, setDigest] = useState(initial?.digest ?? false);
  const [timeZone, setTimeZone] = useState(() => initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(timeZone) ? all : [timeZone, ...all];
  }, [timeZone]);
  const id = initial ? `webhook-${initial.id}` : "webhook-new";
  const pending = create.isPending || update.isPending;
  const toggle = (set: Set<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fields = {
          name,
          events: DISCORD_EVENTS.filter((ev) => events.has(ev)),
          boardIds: boards.filter((b) => boardIds.has(b.id)).map((b) => b.id),
          digest,
          timeZone,
        };
        const done = () => {
          toast.success(`Webhook ${name.trim()} saved`);
          onDone();
        };
        if (initial) update.mutate({ project: slug, id: initial.id, patch: { ...fields, ...(url.trim() ? { url } : {}) } }, { onSuccess: done });
        else create.mutate({ project: slug, webhook: { ...fields, url } }, { onSuccess: done });
      }}
    >
      <DialogHeader>
        <DialogTitle>{initial ? `Edit ${initial.name}` : "Add Discord webhook"}</DialogTitle>
        <DialogDescription>Posts the project&apos;s changes into a Discord channel.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input id={`${id}-name`} placeholder="e.g. #roadmap" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-url`}>Webhook URL</FieldLabel>
          <Input
            id={`${id}-url`}
            type="url"
            autoComplete="off"
            className="font-mono text-[13px]"
            placeholder={initial ? `…/••••${initial.urlHint} (leave empty to keep)` : "https://discord.com/api/webhooks/…"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <FieldDescription>Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</FieldDescription>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Events</FieldLegend>
          <div className="grid gap-2 sm:grid-cols-2">
            {DISCORD_EVENTS.map((ev: DiscordEvent) => (
              <div key={ev} className="flex items-center gap-2.5">
                <Checkbox id={`${id}-event-${ev}`} checked={events.has(ev)} onCheckedChange={(on) => setEvents((s) => toggle(s, ev, on === true))} />
                <label htmlFor={`${id}-event-${ev}`} className="text-[13.5px]">
                  {DISCORD_EVENT_LABEL[ev]}
                </label>
              </div>
            ))}
          </div>
        </FieldSet>
        {boards.length > 0 && (
          <FieldSet>
            <FieldLegend variant="label">Boards</FieldLegend>
            <FieldDescription>{boardIds.size === 0 ? "None selected: all boards." : "Only systems on the selected boards."}</FieldDescription>
            <div className="grid gap-2 sm:grid-cols-2">
              {boards.map((b) => (
                <div key={b.id} className="flex items-center gap-2.5">
                  <Checkbox id={`${id}-board-${b.id}`} checked={boardIds.has(b.id)} onCheckedChange={(on) => setBoardIds((s) => toggle(s, b.id, on === true))} />
                  <label htmlFor={`${id}-board-${b.id}`} className="text-[13.5px]">
                    {b.name}
                  </label>
                </div>
              ))}
            </div>
          </FieldSet>
        )}
        <div className="flex items-center gap-3">
          <Switch id={`${id}-digest`} checked={digest} onCheckedChange={setDigest} />
          <Label htmlFor={`${id}-digest`}>Weekly digest on Mondays at 09:00</Label>
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-zone`}>Time zone</FieldLabel>
          <NativeSelect id={`${id}-zone`} value={timeZone} disabled={!digest} onChange={(e) => setTimeZone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim() || events.size === 0 || (!initial && !url.trim())}>
          {initial ? "Save webhook" : "Add webhook"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A button opening the webhook form in a dialog, to add one or edit `initial`. */
function WebhookDialog({ slug, boards, initial, trigger }: { slug: string; boards: BoardOption[]; initial: WebhookItem | null; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <WebhookForm slug={slug} boards={boards} initial={initial} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** One webhook: its name, URL hint, last delivery and why it is off, with its switch and actions. */
function WebhookRow({ slug, boards, webhook, canEdit }: { slug: string; boards: BoardOption[]; webhook: WebhookItem; canEdit: boolean }) {
  const trpc = useTRPC();
  const now = useNow();
  const update = useMutation(trpc.webhooks.update.mutationOptions());
  const sendTest = useMutation(
    trpc.webhooks.sendTest.mutationOptions({ onSuccess: () => toast.success(`Test message to ${webhook.name} queued`) }),
  );
  const remove = useMutation(trpc.webhooks.delete.mutationOptions({ onSuccess: () => toast.success(`Webhook ${webhook.name} deleted`) }));
  const scope = webhook.boardIds.length === 0 ? "All boards" : boards.filter((b) => webhook.boardIds.includes(b.id)).map((b) => b.name).join(", ") || "No boards";
  return (
    <li className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <Switch
        aria-label={`Enable ${webhook.name}`}
        checked={webhook.enabled}
        disabled={!canEdit || update.isPending}
        onCheckedChange={(enabled) => update.mutate({ project: slug, id: webhook.id, patch: { enabled } })}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{webhook.name}</span>
          <span className="font-mono text-xs text-muted-foreground">…/••••{webhook.urlHint}</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          {webhook.lastSentAt ? `Last sent ${relativeAge(webhook.lastSentAt.toISOString(), now)}` : "Nothing sent yet"} · {scope} ·{" "}
          {webhook.events.length} {webhook.events.length === 1 ? "event" : "events"}
          {webhook.digest && " · weekly digest"}
        </p>
        {!webhook.enabled && webhook.disabledReason && <p className="mt-1 text-[12.5px] font-medium text-destructive">{webhook.disabledReason}</p>}
      </div>
      {canEdit && (
        <span className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" disabled={sendTest.isPending} onClick={() => sendTest.mutate({ project: slug, id: webhook.id })}>
            Send test message
          </Button>
          <WebhookDialog
            slug={slug}
            boards={boards}
            initial={webhook}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${webhook.name}`} className="text-muted-foreground">
                <PencilIcon />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${webhook.name}`} disabled={remove.isPending} className="text-muted-foreground">
                <XIcon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete webhook {webhook.name}?</AlertDialogTitle>
                <AlertDialogDescription>The channel gets no more notifications from this project; pending ones are dropped.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate({ project: slug, id: webhook.id })}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </span>
      )}
    </li>
  );
}

/**
 * The Notifications settings body for owners: the project's Discord webhooks with an enable switch, a test message,
 * editing and deletion, and a dialog adding one.
 *
 * @param props.slug the project slug
 */
export function WebhooksView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: webhooks }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.webhooks.list.queryOptions({ project: slug })],
  });
  const canEdit = !detail.project.archivedAt;
  const boards = detail.boards.map((b) => ({ id: b.id, name: b.name }));
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        <div className="flex-1">
          <h2 className="font-display text-[19px] font-semibold">Discord webhooks</h2>
          <p className="text-[12.5px] text-muted-foreground">Post the project&apos;s changes into Discord channels</p>
        </div>
        {canEdit && <WebhookDialog slug={slug} boards={boards} initial={null} trigger={<Button>Add Discord webhook</Button>} />}
      </header>
      <ul>
        {webhooks.map((w) => (
          <WebhookRow key={w.id} slug={slug} boards={boards} webhook={w} canEdit={canEdit} />
        ))}
        {webhooks.length === 0 && (
          <li className="border-t px-4 py-4 text-[13.5px] text-muted-foreground">No webhooks yet.{canEdit && " Add one to post changes into a Discord channel."}</li>
        )}
      </ul>
    </section>
  );
}
