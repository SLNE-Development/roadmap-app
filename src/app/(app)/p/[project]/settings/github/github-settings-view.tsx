"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
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
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The three automation rules, in the order the settings show them; each is labelled by `integrations.github.rules.<key>`. */
const RULES: { key: keyof RepoRules }[] = [{ key: "closeOnMerge" }, { key: "reviewOnOpen" }, { key: "checksWarning" }];

/** A small square status pill. */
function Pill({ tone, children }: { tone: "done" | "blocked" | "muted"; children: React.ReactNode }) {
  const toneClass = { done: "bg-cat-done-soft text-cat-done", blocked: "bg-cat-blocked-soft text-cat-blocked", muted: "bg-secondary text-fg-2" }[tone];
  return <span className={cn("inline-block px-2 py-0.5 text-xs font-semibold whitespace-nowrap", toneClass)}>{children}</span>;
}

/** Copies `text` to the clipboard and says whether it worked. */
async function copy(text: string, messages: { copied: string; failed: string }): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.copied);
  } catch {
    toast.error(messages.failed);
  }
}

/** A labelled read-only value with a Copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations("integrations");
  const tc = useTranslations("common");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-fg-2">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate border bg-muted px-2 py-1.5 font-mono text-[12.5px]">{value}</code>
        <Button type="button" variant="outline" size="sm" aria-label={t("github.copyLabel", { label })} onClick={() => copy(value, { copied: tc("copied"), failed: t("github.copyFailed") })}>
          {tc("copy")}
        </Button>
      </div>
    </div>
  );
}

/** The payload URL and secret of a manual webhook, with what to do with them on GitHub. */
function WebhookSettings({ webhook, hint }: { webhook: RepoWebhook; hint?: string }) {
  const t = useTranslations("integrations");
  return (
    <div className="flex flex-col gap-2.5 border bg-background p-3">
      <CopyField label={t("github.payloadUrl")} value={webhook.webhookUrl} />
      <CopyField label={t("github.secret")} value={webhook.secret} />
      <p className="text-[12.5px] text-muted-foreground">
        {t("github.webhookInstructions")}
      </p>
      {hint && <p className="text-[12.5px] font-medium text-cat-review">{hint}</p>}
    </div>
  );
}

/** One linked repository: its name, mode, last event and pills, its rule switches for owners, and its actions. */
function RepoRow({ repo, canOwn, canLink }: { repo: LinkedRepoView; canOwn: boolean; canLink: boolean }) {
  const t = useTranslations("integrations");
  const format = useFormatter();
  const trpc = useTRPC();
  const now = useNow();
  const [webhook, setWebhook] = useState<RepoWebhook | null>(null);
  const setRules = useMutation(trpc.github.setRules.mutationOptions());
  const reveal = useMutation(trpc.github.revealSecret.mutationOptions({ onSuccess: setWebhook }));
  const unlink = useMutation(trpc.github.unlink.mutationOptions({ onSuccess: () => toast.success(t("github.unlinked", { name: repo.fullName })) }));
  const lastEvent = repo.lastEventAt ? t("github.lastEvent", { age: format.relativeTime(repo.lastEventAt, now) }) : t("github.noEvents");
  const isApp = repo.mode === "app";
  const activeRules = RULES.filter((r) => repo.rules[r.key]).map((r) => t(`github.rules.${r.key}`));
  return (
    <li className="flex flex-col gap-3 border-t px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold break-all">{repo.fullName}</span>
            {isApp ? <Pill tone="done">{t("github.pillApp")}</Pill> : <Pill tone="muted">{t("github.pillWebhook")}</Pill>}
            {repo.access === "lost" && <Pill tone="blocked">{t("github.accessLost")}</Pill>}
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {isApp ? t("github.modeApp") : t("github.modeWebhook")} · {lastEvent}
          </p>
        </div>
        {canLink && (
          <span className="flex shrink-0 items-center gap-1">
            {!isApp && (
              <Button variant="outline" size="sm" disabled={reveal.isPending} onClick={() => (webhook ? setWebhook(null) : reveal.mutate({ id: repo.id }))}>
                {webhook ? t("github.hideWebhook") : t("github.showWebhook")}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={unlink.isPending}>
                  {t("github.unlink")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("github.unlinkTitle", { name: repo.fullName })}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("github.unlinkDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("github.keep")}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => unlink.mutate({ id: repo.id })}>
                    {t("github.unlink")}
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
              <div key={rule.key} className="flex items-center gap-2.5" title={needsApp ? t("github.needsApp") : undefined}>
                <Switch
                  id={id}
                  checked={repo.rules[rule.key]}
                  disabled={needsApp || setRules.isPending}
                  onCheckedChange={(on) => setRules.mutate({ id: repo.id, rules: { [rule.key]: on } })}
                />
                <Label htmlFor={id} className={cn(needsApp && "text-muted-foreground")}>
                  {t(`github.rules.${rule.key}`)}
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
  const t = useTranslations("integrations");
  const trpc = useTRPC();
  const [fullName, setFullName] = useState("");
  const [linked, setLinked] = useState<{ fullName: string; webhook: RepoWebhook; hint?: string } | null>(null);
  const link = useMutation(
    trpc.github.linkManualRepo.mutationOptions({
      onSuccess: ({ repo, webhookUrl, secret, hint }) => {
        setLinked({ fullName: repo.fullName, webhook: { webhookUrl, secret }, hint });
        setFullName("");
        toast.success(t("github.linked", { name: repo.fullName }));
      },
    }),
  );
  const parsed = repoFullNameSchema.safeParse(fullName);
  const showError = fullName.trim() !== "" && !parsed.success;
  return (
    <section className="flex flex-col gap-3 border bg-card px-4 py-3.5">
      <div>
        <h2 className="font-display text-[19px] font-semibold">{t("github.manualTitle")}</h2>
        <p className="text-[12.5px] text-muted-foreground">{t("github.manualHint")}</p>
      </div>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) link.mutate({ project: slug, repo: { fullName: parsed.data } });
        }}
      >
        <Label htmlFor="manual-repo">{t("github.repository")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="manual-repo"
            ref={inputRef}
            placeholder={t("github.repoPlaceholder")}
            autoComplete="off"
            className="max-w-sm flex-1 font-mono text-[13px]"
            aria-invalid={showError || undefined}
            aria-describedby={showError ? "manual-repo-error" : undefined}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Button type="submit" disabled={!parsed.success || link.isPending}>
            {t("github.linkRepository")}
          </Button>
        </div>
        {showError && (
          <p id="manual-repo-error" className="text-[12.5px] text-destructive">
            {t("github.invalidName")}
          </p>
        )}
      </form>
      {linked && (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] font-medium">{t("github.webhookFor", { name: linked.fullName })}</p>
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
  const t = useTranslations("integrations");
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
          <h2 className="font-display text-[19px] font-semibold">{t("github.title")}</h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {t.rich("github.notConfigured", {
              place: (chunks) =>
                status.isAdmin ? (
                  <Link href="/admin/github" className="font-medium text-brand-strong hover:underline">
                    {chunks}
                  </Link>
                ) : (
                  chunks
                ),
            })}
          </p>
        </section>
      )}
      {(appConfigured || repos.length > 0) && (
        <section className="flex flex-col border bg-card">
          <header className="flex flex-col gap-3 px-4 py-3.5">
            <div>
              <h2 className="font-display text-[19px] font-semibold">{t("github.linkedTitle")}</h2>
              <p className="text-[12.5px] text-muted-foreground">{t("github.linkedHint")}</p>
            </div>
            {appConfigured && canLink && <RepoPicker slug={slug} onManual={() => manualInput.current?.focus()} />}
          </header>
          <ul>
            {repos.map((r) => (
              <RepoRow key={r.id} repo={r} canOwn={canOwn} canLink={canLink} />
            ))}
            {repos.length === 0 && <li className="border-t px-4 py-4 text-[13.5px] text-muted-foreground">{t("github.empty")}</li>}
          </ul>
        </section>
      )}
      {canLink && <ManualForm slug={slug} inputRef={manualInput} />}
    </div>
  );
}
