"use client";

import { useMutation, useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Copy, GitBranch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import type { AppSummary, InstallationView } from "@/lib/ops/github-app";
import { plural } from "@/lib/text";
import { formatDate, relativeAge } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The URLs an existing App must be configured with on GitHub. */
export interface AppUrls {
  webhook: string;
  setup: string;
  oauth: string;
}

/** The message of each `?error=` the GitHub redirects come back with. */
const ERROR_MESSAGE: Record<string, string> = {
  state: "This GitHub App setup link expired or was started by someone else. Start again.",
  github: "GitHub did not answer as expected. Try again in a moment.",
  installation: "GitHub does not know that installation. Install the app again.",
};

/** Class of the label above each form field. */
const LABEL = "text-[12.5px] font-semibold text-fg-2";

/** A small square status pill. */
function Pill({ tone, children }: { tone: "done" | "review" | "muted"; children: React.ReactNode }) {
  const toneClass = { done: "bg-cat-done-soft text-cat-done", review: "bg-cat-review-soft text-cat-review", muted: "bg-secondary text-fg-2" }[tone];
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

/**
 * The GitHub App admin page body: the two ways to set the App up, or, once it exists, its installations,
 * settings and webhook health. Shows a toast for the outcome GitHub's redirect carried in the URL.
 */
export function GitHubAdminView({
  defaultName,
  urls,
  created,
  requested,
  error,
}: {
  defaultName: string;
  urls: AppUrls;
  created: boolean;
  requested: boolean;
  error: string | undefined;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const { data: app } = useSuspenseQuery(trpc.github.app.queryOptions());

  useEffect(() => {
    if (!created && !requested && !error) return;
    if (created) toast.success("GitHub App created. Install it on an account next.", { id: "github-created" });
    else if (requested) toast.success("Install requested. An owner of the organization has to approve it on GitHub.", { id: "github-requested" });
    else if (error) {
      toast.error(Object.hasOwn(ERROR_MESSAGE, error) ? ERROR_MESSAGE[error] : "Something went wrong with GitHub. Try again.", { id: "github-error" });
    }
    router.replace("/admin/github", { scroll: false });
  }, [created, requested, error, router]);

  if (!app) {
    return (
      <Page width="medium">
        <PageHeader
          crumbs={[{ label: "Admin" }]}
          title="GitHub App"
          description="Connect a GitHub App so projects can link repositories and follow pull requests, commits and checks."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <CreateAppCard defaultName={defaultName} />
          <ExistingAppCard urls={urls} />
        </div>
      </Page>
    );
  }
  return <ConnectedApp app={app} />;
}

/** Creates the App on GitHub from a manifest: GitHub asks to confirm and redirects back with the credentials. */
function CreateAppCard({ defaultName }: { defaultName: string }) {
  const trpc = useTRPC();
  const start = useMutation(trpc.github.startManifest.mutationOptions());
  const [org, setOrg] = useState("");
  const [name, setName] = useState(defaultName);
  return (
    <Panel title="Create GitHub App" bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5">
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
          GitHub registers a private App with read-only access to code, pull requests and checks, then sends you back here.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-org" className={LABEL}>
            Create under an organization (optional)
          </Label>
          <Input id="gh-org" placeholder="e.g. SLNE-Development" maxLength={39} value={org} onChange={(e) => setOrg(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-name" className={LABEL}>
            App name
          </Label>
          <Input id="gh-name" maxLength={34} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Button type="submit" disabled={start.isPending}>
            Create on GitHub ↗
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
    <Panel title="Use an existing app" bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5 gap-5">
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
            { onSuccess: () => toast.success("GitHub App connected. Install it on an account next."), onError: (err) => toast.error(err.message) },
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {field("appId", "App ID", { inputMode: "numeric", pattern: "[0-9]+" })}
          {field("slug", "Slug", { placeholder: "e.g. roadmap-app" })}
          {field("name", "Name")}
          {field("ownerLogin", "Owner")}
          {field("clientId", "Client ID")}
          {field("clientSecret", "Client secret", { type: "password", autoComplete: "off" })}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-privateKey" className={LABEL}>
            Private key
          </Label>
          <Textarea
            id="gh-privateKey"
            required
            rows={4}
            className="font-mono text-[12px]"
            placeholder="-----BEGIN RSA PRIVATE KEY-----"
            value={form.privateKey}
            onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
          />
        </div>
        {field("webhookSecret", "Webhook secret", { type: "password", autoComplete: "off" })}
        <div>
          <Button type="submit" variant="outline" disabled={save.isPending}>
            Save credentials
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-[12.5px] font-semibold text-fg-2">Configure these URLs on GitHub</p>
        {(
          [
            ["Webhook URL", urls.webhook],
            ["Setup URL", urls.setup],
            ["Callback URL", urls.oauth],
          ] as const
        ).map(([label, url]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-muted-foreground">{label}</span>
              <code className="truncate font-mono text-[12.5px]">{url}</code>
            </div>
            <Button type="button" variant="outline" size="sm" aria-label={`Copy the ${label.toLowerCase()}`} onClick={() => void copy(url)}>
              <Copy aria-hidden />
              Copy
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** The selection column of an installation: "All repos (n)" or "n selected repos". */
function selectionLabel(i: InstallationView): string {
  if (i.repositorySelection === "all") return i.repoCount === null ? "All repos" : `All repos (${i.repoCount})`;  return i.repoCount === null ? "Selected repos" : `${i.repoCount} selected ${i.repoCount === 1 ? "repo" : "repos"}`;
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
  const trpc = useTRPC();
  const now = useNow();
  const [{ data: installations }, { data: requests }] = useSuspenseQueries({
    queries: [trpc.github.installations.queryOptions(), trpc.github.installRequests.queryOptions()],
  });
  // Health asks GitHub, so it loads after the page instead of holding it up.
  const health = useQuery(trpc.github.health.queryOptions());
  const install = useMutation(trpc.github.startInstall.mutationOptions());
  const dismiss = useMutation(trpc.github.dismissRequest.mutationOptions({ onSuccess: () => toast.success("Request dismissed") }));
  const rotate = useMutation(trpc.github.rotateSecret.mutationOptions({ onSuccess: () => toast.success("Webhook secret rotated") }));
  const policy = useMutation(trpc.github.setLinkPolicy.mutationOptions({ onSuccess: () => toast.success("Saved") }));
  const onError = (err: { message: string }) => toast.error(err.message);
  const counted = installations.filter((i) => i.status === "active" && i.repoCount !== null);
  const repos = counted.length === 0 ? "—" : counted.reduce((sum, i) => sum + (i.repoCount ?? 0), 0);
  const lastWebhook = health.data ? (health.data.lastWebhookAt ? relativeAge(health.data.lastWebhookAt.toISOString(), now) : "Never") : "…";

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Admin" }, { label: "GitHub App" }]}
        title={app.name}
        description={
          <>
            App ID {app.appId} · created {app.createdByName ? `by ${app.createdByName} ` : ""}on {formatDate(app.createdAt.toISOString(), now)}
          </>
        }
        actions={<Pill tone="done">Connected</Pill>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Installations" value={installations.filter((i) => i.status === "active").length} />
        <Stat label="Repos visible" value={repos} />
        <Stat label="Last webhook" value={lastWebhook} />
      </div>

      <Panel
        title="Installations"
        meta={plural(installations.length, "installation")}
        action={
          <Button
            size="sm"
            disabled={install.isPending}
            onClick={() => install.mutate({}, { onSuccess: ({ url }) => window.location.assign(url), onError })}
          >
            Install on an account or org ↗
          </Button>
        }
      >
        {installations.length === 0 && requests.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <EmptyState icon={<GitBranch />} title="Not installed yet" description="Install the App on a GitHub account or organization to link its repositories." />
          </div>
        ) : (
          <ul className="flex flex-col border-t">
            {installations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 last:border-b-0 sm:px-5">
                <span className="font-semibold">{i.accountLogin}</span>
                <span className="text-[12.5px] text-fg-2">{i.accountType === "Organization" ? "Organization" : "User"}</span>
                <span className="text-[12.5px] text-fg-2">{selectionLabel(i)}</span>
                <span className="text-[12.5px] text-fg-2">Installed by {i.installedByName ?? "someone on GitHub"}</span>
                {i.status !== "active" && <Pill tone={i.status === "suspended" ? "review" : "muted"}>{i.status === "suspended" ? "Suspended" : "Removed"}</Pill>}
                <a href={i.manageUrl} target="_blank" rel="noreferrer" className="ml-auto text-[12.5px] font-semibold text-primary hover:underline">
                  Manage on GitHub ↗
                </a>
              </li>
            ))}
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 last:border-b-0 sm:px-5">
                <Pill tone="review">Pending</Pill>
                <span className="text-[12.5px] text-fg-2">
                  Install requested by {r.requestedByName} on {formatDate(r.requestedAt.toISOString(), now)}; an organization owner has to approve it on GitHub.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate({ id: r.id }, { onError })}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="App settings" bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5 gap-4">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Permissions</span>
          <span className="text-[12.5px] text-fg-2">
            Read-only: metadata, contents, pull requests and checks. Events: pull requests, pushes and check suites.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] text-fg-2">
            Webhook secret · {app.secretRotatedAt ? `Rotated ${formatDate(app.secretRotatedAt.toISOString(), now)}` : "Never rotated"}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={rotate.isPending}>
                Rotate
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rotate the webhook secret?</AlertDialogTitle>
                <AlertDialogDescription>
                  GitHub switches to the new one right away; deliveries signed with the old one are accepted for 10 minutes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => rotate.mutate(undefined, { onError })}>Rotate</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="flex flex-col gap-1.5 sm:w-64">
          <Label htmlFor="gh-link-policy" className={LABEL}>
            Who can link repos
          </Label>
          <NativeSelect
            id="gh-link-policy"
            className="w-full"
            value={app.linkPolicy}
            disabled={policy.isPending}
            onChange={(e) => policy.mutate({ policy: e.target.value as AppSummary["linkPolicy"] }, { onError })}
          >
            <NativeSelectOption value="owners">Project owners</NativeSelectOption>
            <NativeSelectOption value="admins">Admins only</NativeSelectOption>
          </NativeSelect>
        </div>
        <div>
          <a href={app.htmlUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-primary hover:underline">
            View on GitHub ↗
          </a>
        </div>
      </Panel>

      <Panel title="Health" bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5 gap-3">
        {health.isPending ? (
          <p className="text-[12.5px] text-fg-2">Loading…</p>
        ) : health.isError ? (
          <p className="text-[12.5px] text-destructive">Could not load the health: {health.error.message}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-fg-2">
              <span>Last webhook: {lastWebhook}</span>
              <span>Failed deliveries (24 h): {health.data.failedLast24h}</span>
            </div>
            {health.data.recentErrors.length > 0 && (
              <ul className="flex flex-col border-t">
                {health.data.recentErrors.map((e) => (
                  <li key={e.deliveryId} className="flex flex-wrap gap-x-3 border-b py-2 text-[12.5px] last:border-b-0">
                    <span className="font-semibold">{e.event}</span>
                    <span className="min-w-0 flex-1 text-fg-2">{e.detail ?? "No detail"}</span>
                    <span className="text-muted-foreground">{relativeAge(e.receivedAt.toISOString(), now)}</span>
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
