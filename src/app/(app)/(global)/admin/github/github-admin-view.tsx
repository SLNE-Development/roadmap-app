"use client";

import { useMutation, useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Copy, GitBranch } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useShortDate } from "@/components/account/short-date";
import { useNow } from "@/components/clock";
import { EmptyState, Page, PageHeader, Panel } from "@/components/page";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { appSettingsUrl } from "@/lib/github/urls";
import type { AppSummary, InstallationView } from "@/lib/ops/github-app";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The URLs an existing App must be configured with on GitHub. */
export interface AppUrls {
  webhook: string;
  setup: string;
  oauth: string;
}

/** The `?error=` values the GitHub redirects come back with, each with a message under `admin.github.errors`. */
const KNOWN_ERRORS = ["state", "github", "installation"] as const;

/** Returns whether `error` is one of the {@link KNOWN_ERRORS}. */
function isKnownError(error: string): error is (typeof KNOWN_ERRORS)[number] {
  return (KNOWN_ERRORS as readonly string[]).includes(error);
}

/** Class of the label above each form field. */
const LABEL = "text-[12.5px] font-semibold text-fg-2";

/** A small square status pill. */
function Pill({ tone, children }: { tone: "done" | "review" | "muted"; children: React.ReactNode }) {
  const toneClass = { done: "bg-cat-done-soft text-cat-done", review: "bg-cat-review-soft text-cat-review", muted: "bg-secondary text-fg-2" }[tone];
  return <span className={cn("inline-block px-2 py-0.5 text-xs font-semibold whitespace-nowrap", toneClass)}>{children}</span>;
}

/** Copies `text` to the clipboard and toasts `done` or `failed` by whether it worked. */
async function copy(text: string, done: string, failed: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(failed);
  }
}

/**
 * The GitHub App admin page body: the two ways to set the App up, or, once it exists, its installations,
 * settings and webhook health. Shows a toast for the outcome GitHub's redirect carried in the URL.
 */
export function GitHubAdminView({
  defaultName,
  unreachableOrigin,
  urls,
  created,
  requested,
  error,
}: {
  defaultName: string;
  /** The site's origin when GitHub cannot reach it so the App cannot be created from here, or null when it can. */
  unreachableOrigin: string | null;
  urls: AppUrls;
  created: boolean;
  requested: boolean;
  error: string | undefined;
}) {
  const t = useTranslations("admin.github");
  const trpc = useTRPC();
  const router = useRouter();
  const { data: app } = useSuspenseQuery(trpc.github.app.queryOptions());

  useEffect(() => {
    if (!created && !requested && !error) return;
    if (created) toast.success(t("created"), { id: "github-created" });
    else if (requested) toast.success(t("requested"), { id: "github-requested" });
    else if (error) {
      toast.error(isKnownError(error) ? t(`errors.${error}`) : t("errors.other"), { id: "github-error" });
    }
    router.replace("/admin/github", { scroll: false });
  }, [created, requested, error, router, t]);

  if (!app) {
    return (
      <Page width="medium">
        <PageHeader
          crumbs={[{ label: t("crumb") }]}
          title={t("title")}
          description={t("description")}
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <CreateAppCard defaultName={defaultName} unreachableOrigin={unreachableOrigin} />
          <ExistingAppCard urls={urls} />
        </div>
      </Page>
    );
  }
  return <ConnectedApp app={app} />;
}

/** Creates the App on GitHub from a manifest: GitHub asks to confirm and redirects back with the credentials. */
function CreateAppCard({ defaultName, unreachableOrigin }: { defaultName: string; unreachableOrigin: string | null }) {
  const t = useTranslations("admin.github");
  const trpc = useTRPC();
  const start = useMutation(trpc.github.startManifest.mutationOptions());
  const [org, setOrg] = useState("");
  const [name, setName] = useState(defaultName);
  return (
    <Panel title={t("createTitle")} bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate(
            { org: org.trim() || null, name },
            {
              onSuccess: ({ action, manifest }) => {
                const form = document.createElement("form");
                form.method = "post";
                form.action = action;
                form.hidden = true;
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = "manifest";
                input.value = manifest;
                form.append(input);
                document.body.append(form);
                form.submit();
              },
              onError: (err) => toast.error(err.message),
            },
          );
        }}
      >
        <p className="text-[12.5px] leading-normal text-fg-2">
          {t("createHint")}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-org" className={LABEL}>
            {t("orgLabel")}
          </Label>
          <Input id="gh-org" placeholder={t("orgPlaceholder")} maxLength={39} value={org} onChange={(e) => setOrg(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-name" className={LABEL}>
            {t("appName")}
          </Label>
          <Input id="gh-name" maxLength={34} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {unreachableOrigin && <p className="text-[12.5px] leading-normal text-fg-2">{t("unreachable", { origin: unreachableOrigin })}</p>}
        <div>
          <Button type="submit" disabled={start.isPending || unreachableOrigin !== null}>
            {t("createOnGitHub")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** The fields of the existing-app form, as typed. */
const EMPTY_CREDENTIALS = { appId: "", slug: "", name: "", ownerLogin: "", clientId: "", clientSecret: "", privateKey: "", webhookSecret: "" };

/** Connects an App registered by hand from its credentials, and lists the URLs it must be configured with. */
function ExistingAppCard({ urls }: { urls: AppUrls }) {
  const t = useTranslations("admin.github");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const save = useMutation(trpc.github.saveCredentials.mutationOptions());
  const [form, setForm] = useState(EMPTY_CREDENTIALS);
  const field = (key: keyof typeof EMPTY_CREDENTIALS, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`gh-${key}`} className={LABEL}>
        {label}
      </Label>
      <Input id={`gh-${key}`} required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  );
  return (
    <Panel title={t("existingTitle")} bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5 gap-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const slug = form.slug.trim();
          save.mutate(
            {
              credentials: {
                appId: Number(form.appId),
                slug,
                name: form.name,
                ownerLogin: form.ownerLogin,
                htmlUrl: `https://github.com/apps/${slug}`,
                clientId: form.clientId,
                clientSecret: form.clientSecret,
                privateKey: form.privateKey,
                webhookSecret: form.webhookSecret,
              },
            },
            { onSuccess: () => toast.success(t("connected")), onError: (err) => toast.error(err.message) },
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {field("appId", t("appId"), { inputMode: "numeric", pattern: "[0-9]+" })}
          {field("slug", t("slug"), { placeholder: t("slugPlaceholder") })}
          {field("name", t("name"))}
          {field("ownerLogin", t("owner"))}
          {field("clientId", t("clientId"))}
          {field("clientSecret", t("clientSecret"), { type: "password", autoComplete: "off" })}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-privateKey" className={LABEL}>
            {t("privateKey")}
          </Label>
          <Textarea
            id="gh-privateKey"
            required
            rows={4}
            className="font-mono text-[12px]"
            placeholder={t("privateKeyPlaceholder")}
            value={form.privateKey}
            onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
          />
        </div>
        {field("webhookSecret", t("webhookSecret"), { type: "password", autoComplete: "off" })}
        <div>
          <Button type="submit" variant="outline" disabled={save.isPending}>
            {t("saveCredentials")}
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-[12.5px] font-semibold text-fg-2">{t("configureUrls")}</p>
        {(
          [
            [t("webhookUrl"), urls.webhook, t("copyWebhookUrl")],
            [t("setupUrl"), urls.setup, t("copySetupUrl")],
            [t("callbackUrl"), urls.oauth, t("copyCallbackUrl")],
          ] as const
        ).map(([label, url, copyLabel]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-muted-foreground">{label}</span>
              <code className="truncate font-mono text-[12.5px]">{url}</code>
            </div>
            <Button type="button" variant="outline" size="sm" aria-label={copyLabel} onClick={() => void copy(url, tc("copied"), t("copyFailed"))}>
              <Copy aria-hidden />
              {tc("copy")}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** The selection column of an installation: "All repos (n)" or "n selected repos". */
function selectionLabel(i: InstallationView, t: ReturnType<typeof useTranslations<"admin.github">>): string {
  if (i.repositorySelection === "all") return i.repoCount === null ? t("allRepos") : t("allReposCount", { count: i.repoCount });
  return i.repoCount === null ? t("selectedRepos") : t("selectedReposCount", { count: i.repoCount });
}

/** A labelled number in the stats row. */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-display text-[22px] font-semibold">{value}</span>
    </div>
  );
}

/** The page once the App exists: header, stats, installations, settings and health. */
function ConnectedApp({ app }: { app: AppSummary }) {
  const t = useTranslations("admin.github");
  const tc = useTranslations("common");
  const format = useFormatter();
  const trpc = useTRPC();
  const now = useNow();
  const shortDate = useShortDate(now);
  const [{ data: installations }, { data: requests }] = useSuspenseQueries({
    queries: [trpc.github.installations.queryOptions(), trpc.github.installRequests.queryOptions()],
  });
  // Health asks GitHub, so it loads after the page instead of holding it up.
  const health = useQuery(trpc.github.health.queryOptions());
  const install = useMutation(trpc.github.startInstall.mutationOptions());
  const dismiss = useMutation(trpc.github.dismissRequest.mutationOptions({ onSuccess: () => toast.success(t("requestDismissed")) }));
  const rotate = useMutation(trpc.github.rotateSecret.mutationOptions({ onSuccess: () => toast.success(t("secretRotated")) }));
  const policy = useMutation(trpc.github.setLinkPolicy.mutationOptions({ onSuccess: () => toast.success(tc("saved")) }));
  const onError = (err: { message: string }) => toast.error(err.message);
  // The owner's type isn't stored; it's an organization when an installation on that login says so.
  const ownerIsOrg = installations.some((i) => i.accountType === "Organization" && i.accountLogin.toLowerCase() === app.ownerLogin.toLowerCase());
  const counted = installations.filter((i) => i.status === "active" && i.repoCount !== null);
  const repos = counted.length === 0 ? "—" : counted.reduce((sum, i) => sum + (i.repoCount ?? 0), 0);
  const lastWebhook = health.data ? (health.data.lastWebhookAt ? format.relativeTime(health.data.lastWebhookAt, now) : t("never")) : "…";

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: t("crumb") }, { label: t("title") }]}
        title={app.name}
        description={
          app.createdByName
            ? t("appMetaBy", { id: app.appId, name: app.createdByName, date: shortDate(app.createdAt) })
            : t("appMeta", { id: app.appId, date: shortDate(app.createdAt) })
        }
        actions={<Pill tone="done">{t("connectedPill")}</Pill>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("installations")} value={installations.filter((i) => i.status === "active").length} />
        <Stat label={t("reposVisible")} value={repos} />
        <Stat label={t("lastWebhook")} value={lastWebhook} />
      </div>

      <Panel
        title={t("installations")}
        meta={t("installationCount", { count: installations.length })}
        action={
          <Button
            size="sm"
            disabled={install.isPending}
            onClick={() => install.mutate({}, { onSuccess: ({ url }) => window.location.assign(url), onError })}
          >
            {t("install")}
          </Button>
        }
      >
        {installations.length === 0 && requests.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <EmptyState icon={<GitBranch />} title={t("notInstalled")} description={t("notInstalledHint")} />
          </div>
        ) : (
          <ul className="flex flex-col border-t">
            {installations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 last:border-b-0 sm:px-5">
                <span className="font-semibold">{i.accountLogin}</span>
                <span className="text-[12.5px] text-fg-2">{i.accountType === "Organization" ? t("organization") : t("user")}</span>
                <span className="text-[12.5px] text-fg-2">{selectionLabel(i, t)}</span>
                <span className="text-[12.5px] text-fg-2">{i.installedByName ? t("installedBy", { name: i.installedByName }) : t("installedBySomeone")}</span>
                {i.status !== "active" && <Pill tone={i.status === "suspended" ? "review" : "muted"}>{i.status === "suspended" ? t("suspended") : t("removed")}</Pill>}
                <a href={i.manageUrl} target="_blank" rel="noreferrer" className="ml-auto text-[12.5px] font-semibold text-primary hover:underline">
                  {t("manage")}
                </a>
              </li>
            ))}
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 last:border-b-0 sm:px-5">
                <Pill tone="review">{t("pending")}</Pill>
                <span className="text-[12.5px] text-fg-2">
                  {t("requestedBy", { name: r.requestedByName, date: shortDate(r.requestedAt) })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate({ id: r.id }, { onError })}
                >
                  {t("dismiss")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-4 pb-4 text-[12.5px] text-fg-2 sm:px-5 sm:pb-5">{t("installOtherAccounts")}</p>
      </Panel>

      <Panel title={t("settingsTitle")} bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5 gap-4">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>{t("permissions")}</span>
          <span className="text-[12.5px] text-fg-2">
            {t("permissionsHint")}
          </span>
          {health.data && health.data.missing.length > 0 && (
            <p className="text-[12.5px] text-destructive">
              {t("missingPermissions", { list: health.data.missing.join(", ") })}{" "}
              <a href={appSettingsUrl(app, ownerIsOrg)} target="_blank" rel="noreferrer" className="font-semibold underline">
                {t("view")}
              </a>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] text-fg-2">
            {t("webhookSecret")} · {app.secretRotatedAt ? t("rotatedOn", { date: shortDate(app.secretRotatedAt) }) : t("neverRotated")}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={rotate.isPending}>
                {t("rotate")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("rotateTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("rotateDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => rotate.mutate(undefined, { onError })}>{t("rotate")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="flex flex-col gap-1.5 sm:w-64">
          <Label htmlFor="gh-link-policy" className={LABEL}>
            {t("linkPolicy")}
          </Label>
          <NativeSelect
            id="gh-link-policy"
            className="w-full"
            value={app.linkPolicy}
            disabled={policy.isPending}
            onChange={(e) => policy.mutate({ policy: e.target.value as AppSummary["linkPolicy"] }, { onError })}
          >
            <NativeSelectOption value="owners">{t("policyOwners")}</NativeSelectOption>
            <NativeSelectOption value="admins">{t("policyAdmins")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <div>
          <a href={app.htmlUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-primary hover:underline">
            {t("view")}
          </a>
        </div>
      </Panel>

      <Panel title={t("health")} bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5 gap-3">
        {health.isPending ? (
          <p className="text-[12.5px] text-fg-2">{tc("loading")}</p>
        ) : health.isError ? (
          <p className="text-[12.5px] text-destructive">{t("healthFailed", { message: health.error.message })}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-fg-2">
              <span>{t("lastWebhookLine", { when: lastWebhook })}</span>
              <span>{t("failedDeliveries", { count: health.data.failedLast24h })}</span>
            </div>
            {health.data.recentErrors.length > 0 && (
              <ul className="flex flex-col border-t">
                {health.data.recentErrors.map((e) => (
                  <li key={e.deliveryId} className="flex flex-wrap gap-x-3 border-b py-2 text-[12.5px] last:border-b-0">
                    <span className="font-semibold">{e.event}</span>
                    <span className="min-w-0 flex-1 text-fg-2">{e.detail ?? t("noDetail")}</span>
                    <span className="text-muted-foreground">{format.relativeTime(e.receivedAt, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </Page>
  );
}
