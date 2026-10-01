"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { RepoPicker } from "@/components/github/repo-picker";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { RepoRules } from "@/db/schema";
import { repoFullNameSchema } from "@/lib/github/repo-name";
import type { LinkedRepoView, RepoWebhook } from "@/lib/ops/github-repos";
import { relativeAge } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The three automation rules, in the order the settings show them. */
const RULES: { key: keyof RepoRules; label: string }[] = [
  { key: "closeOnMerge", label: "Close tasks when a PR merges" },
  { key: "reviewOnOpen", label: "Move to review when a PR opens" },
  { key: "checksWarning", label: "Warn when checks fail" },
];

/** A small square status pill. */
function Pill({ tone, children }: { tone: "done" | "blocked" | "muted"; children: React.ReactNode }) {
  const toneClass = { done: "bg-cat-done-soft text-cat-done", blocked: "bg-cat-blocked-soft text-cat-blocked", muted: "bg-secondary text-fg-2" }[tone];
  return <span className={cn("inline-block px-2 py-0.5 text-xs font-semibold whitespace-nowrap", toneClass)}>{children}</span>;
}

/** Copies `text` to the clipboard and says whether it worked. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Copying failed. Select the text and copy it by hand.");
  }
}

/** A labelled read-only value with a Copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-fg-2">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate border bg-muted px-2 py-1.5 font-mono text-[12.5px]">{value}</code>
        <Button type="button" variant="outline" size="sm" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => copy(value)}>
          Copy
        </Button>
      </div>
    </div>
  );
}

/** The payload URL and secret of a manual webhook, with what to do with them on GitHub. */
function WebhookSettings({ webhook, hint }: { webhook: RepoWebhook; hint?: string }) {
  return (
    <div className="flex flex-col gap-2.5 border bg-background p-3">
      <CopyField label="Payload URL" value={webhook.webhookUrl} />
      <CopyField label="Secret" value={webhook.secret} />
      <p className="text-[12.5px] text-muted-foreground">
        Paste into the repository&apos;s Settings → Webhooks, content type application/json, events: pull requests and pushes.
      </p>
      {hint && <p className="text-[12.5px] font-medium text-cat-review">{hint}</p>}
    </div>
  );
}

/** One linked repository: its name, mode, last event and pills, its rule switches for owners, and its actions. */
function RepoRow({ repo, canOwn, canLink }: { repo: LinkedRepoView; canOwn: boolean; canLink: boolean }) {
  const trpc = useTRPC();
  const now = useNow();
  const [webhook, setWebhook] = useState<RepoWebhook | null>(null);
  const setRules = useMutation(trpc.github.setRules.mutationOptions());
  const reveal = useMutation(trpc.github.revealSecret.mutationOptions({ onSuccess: setWebhook }));
  const unlink = useMutation(trpc.github.unlink.mutationOptions({ onSuccess: () => toast.success(`${repo.fullName} unlinked`) }));
  const lastEvent = repo.lastEventAt ? `last event ${relativeAge(repo.lastEventAt.toISOString(), now)}` : "no events yet";
  const isApp = repo.mode === "app";
  const activeRules = RULES.filter((r) => repo.rules[r.key]).map((r) => r.label);
  return (
    <li className="flex flex-col gap-3 border-t px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold break-all">{repo.fullName}</span>
            {isApp ? <Pill tone="done">App</Pill> : <Pill tone="muted">webhook</Pill>}
            {repo.access === "lost" && <Pill tone="blocked">access lost</Pill>}
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {isApp ? "GitHub App" : "Webhook only"} · {lastEvent}
          </p>
        </div>
        {canLink && (
          <span className="flex shrink-0 items-center gap-1">
            {!isApp && (
              <Button variant="outline" size="sm" disabled={reveal.isPending} onClick={() => (webhook ? setWebhook(null) : reveal.mutate({ id: repo.id }))}>
                {webhook ? "Hide webhook settings" : "Show webhook settings"}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={unlink.isPending}>
                  Unlink
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unlink {repo.fullName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its pull requests and commits disappear from tasks and systems, and new events from it are ignored.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => unlink.mutate({ id: repo.id })}>
                    Unlink
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </span>
        )}
      </div>
      {canOwn ? (
        <div className="flex flex-col gap-2">
          {RULES.map((rule) => {
            const needsApp = rule.key === "checksWarning" && !isApp;
            const id = `rule-${repo.id}-${rule.key}`;
            return (
              <div key={rule.key} className="flex items-center gap-2.5" title={needsApp ? "Needs the GitHub App" : undefined}>
                <Switch
                  id={id}
                  checked={repo.rules[rule.key]}
                  disabled={needsApp || setRules.isPending}
                  onCheckedChange={(on) => setRules.mutate({ id: repo.id, rules: { [rule.key]: on } })}
                />
                <Label htmlFor={id} className={cn(needsApp && "text-muted-foreground")}>
                  {rule.label}
                </Label>
              </div>
            );
          })}
        </div>
      ) : (
        activeRules.length > 0 && <p className="text-[12.5px] text-muted-foreground">{activeRules.join(" · ")}</p>
      )}
      {webhook && <WebhookSettings webhook={webhook} />}
    </li>
  );
}

/** The "Add by hand" panel: links `owner/repo` through its own webhook and shows the settings to paste on GitHub. */
function ManualForm({ slug, inputRef }: { slug: string; inputRef: React.Ref<HTMLInputElement> }) {
  const trpc = useTRPC();
  const [fullName, setFullName] = useState("");
  const [linked, setLinked] = useState<{ fullName: string; webhook: RepoWebhook; hint?: string } | null>(null);
  const link = useMutation(
    trpc.github.linkManualRepo.mutationOptions({
      onSuccess: ({ repo, webhookUrl, secret, hint }) => {
        setLinked({ fullName: repo.fullName, webhook: { webhookUrl, secret }, hint });
        setFullName("");
        toast.success(`${repo.fullName} linked`);
      },
    }),
  );
  const parsed = repoFullNameSchema.safeParse(fullName);
  const showError = fullName.trim() !== "" && !parsed.success;
  return (
    <section className="flex flex-col gap-3 border bg-card px-4 py-3.5">
      <div>
        <h2 className="font-display text-[19px] font-semibold">Add by hand</h2>
        <p className="text-[12.5px] text-muted-foreground">Link a repository through its own webhook, without the GitHub App</p>
      </div>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) link.mutate({ project: slug, repo: { fullName: parsed.data } });
        }}
      >
        <Label htmlFor="manual-repo">Repository</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="manual-repo"
            ref={inputRef}
            placeholder="owner/repo"
            autoComplete="off"
            className="max-w-sm flex-1 font-mono text-[13px]"
            aria-invalid={showError || undefined}
            aria-describedby={showError ? "manual-repo-error" : undefined}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Button type="submit" disabled={!parsed.success || link.isPending}>
            Link repository
          </Button>
        </div>
        {showError && (
          <p id="manual-repo-error" className="text-[12.5px] text-destructive">
            {parsed.error.issues[0]?.message}
          </p>
        )}
      </form>
      {linked && (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] font-medium">Webhook settings for {linked.fullName}</p>
          <WebhookSettings webhook={linked.webhook} hint={linked.hint} />
        </div>
      )}
    </section>
  );
}

/**
 * The GitHub settings body: the linked repositories with their rules, the picker of repositories the App can see,
 * and the manual webhook form. Viewers read the list only.
 *
 * @param props.slug the project slug
 */
export function GitHubSettingsView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: repos }, { data: status }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.github.repos.queryOptions({ project: slug }),
      trpc.github.linkStatus.queryOptions({ project: slug }),
    ],
  });
  const manualInput = useRef<HTMLInputElement>(null);
  const canOwn = (detail.role === "owner" || detail.role === "admin") && !detail.project.archivedAt;
  const { appConfigured, canLink } = status;
  return (
    <div className="flex flex-col gap-5">
      {!appConfigured && (
        <section className="border bg-card px-4 py-3.5">
          <h2 className="font-display text-[19px] font-semibold">GitHub</h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            GitHub isn&apos;t set up on this instance. An admin can set it up under{" "}
            {status.isAdmin ? (
              <Link href="/admin/github" className="font-medium text-brand-strong hover:underline">
                Admin → GitHub App
              </Link>
            ) : (
              "Admin → GitHub App"
            )}
            .
          </p>
        </section>
      )}
      {(appConfigured || repos.length > 0) && (
        <section className="flex flex-col border bg-card">
          <header className="flex flex-col gap-3 px-4 py-3.5">
            <div>
              <h2 className="font-display text-[19px] font-semibold">Linked repositories</h2>
              <p className="text-[12.5px] text-muted-foreground">Pull requests and commits that mention a task show up on it</p>
            </div>
            {appConfigured && canLink && <RepoPicker slug={slug} onManual={() => manualInput.current?.focus()} />}
          </header>
          <ul>
            {repos.map((r) => (
              <RepoRow key={r.id} repo={r} canOwn={canOwn} canLink={canLink} />
            ))}
            {repos.length === 0 && <li className="border-t px-4 py-4 text-[13.5px] text-muted-foreground">No repositories linked yet.</li>}
          </ul>
        </section>
      )}
      {canLink && <ManualForm slug={slug} inputRef={manualInput} />}
    </div>
  );
}
