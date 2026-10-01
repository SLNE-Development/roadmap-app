import type { App } from "@octokit/app";
import type { Db } from "@/db/types";
import { ConflictError, InvalidError } from "@/lib/ops/errors";
import { loadAppConfig, type GitHubAppConfig } from "@/lib/ops/github-app";

/** What GitHub returns when a manifest-created App is converted, in camelCase. */
export interface ManifestConversion {
  id: number;
  slug: string;
  name: string;
  ownerLogin: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  pem: string;
}

/** An installation of the App on a user or organization account. */
export interface InstallationInfo {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  suspended: boolean;
}

/** A repository an installation can access. */
export interface RepoInfo {
  id: number;
  fullName: string;
  ownerLogin: string;
  private: boolean;
}

/** A webhook delivery GitHub could not deliver successfully. */
export interface FailedDelivery {
  id: number;
  event: string;
  deliveredAt: Date;
  statusCode: number;
}

/** A check suite on a commit. */
export interface CheckSuiteInfo {
  status: string;
  conclusion: string | null;
}

/** The GitHub calls the app makes; production uses {@link octokitGitHubApi}, tests use `fakeGitHubApi`. */
export interface GitHubApi {
  /** Exchanges the code from the App manifest flow for the new App's credentials; needs no App. */
  convertManifest(code: string): Promise<ManifestConversion>;
  /** Returns the installation, or null when GitHub does not know it. */
  getInstallation(id: number): Promise<InstallationInfo | null>;
  listInstallations(): Promise<InstallationInfo[]>;
  listInstallationRepos(installationId: number): Promise<RepoInfo[]>;
  updateWebhookSecret(secret: string): Promise<void>;
  /** Returns the deliveries newer than `since` whose status is not "OK". */
  listFailedDeliveries(since: Date): Promise<FailedDelivery[]>;
  listCheckSuites(installationId: number, fullName: string, sha: string): Promise<CheckSuiteInfo[]>;
  /** Exchanges an OAuth code for the GitHub user who signed in; the access token is discarded. */
  exchangeOAuthCode(code: string): Promise<{ id: number; login: string }>;
}

interface GhInstallation {
  id: number;
  account: { login?: string; type?: string } | null;
  repository_selection: "all" | "selected";
  suspended_at: string | null;
}

/** Maps GitHub's installation shape to {@link InstallationInfo}. */
function toInstallation(i: GhInstallation): InstallationInfo {
  return {
    id: i.id,
    accountLogin: i.account?.login ?? "",
    accountType: i.account?.type === "Organization" ? "Organization" : "User",
    repositorySelection: i.repository_selection,
    suspended: i.suspended_at !== null,
  };
}

/** Splits `owner/repo`. */
function splitFullName(fullName: string): { owner: string; repo: string } {
  const at = fullName.indexOf("/");
  return { owner: fullName.slice(0, at), repo: fullName.slice(at + 1) };
}

interface OctokitModules {
  App: typeof import("@octokit/app").App;
  Octokit: typeof import("@octokit/core").Octokit;
  paginateRest: typeof import("@octokit/plugin-paginate-rest").paginateRest;
  request: typeof import("@octokit/request").request;
}

let octokitModules: Promise<OctokitModules> | undefined;

/**
 * Loads the Octokit packages on first use. They are ESM-only, and the dev worker (tsx) loads this module through
 * `require`, so a static import would crash it at startup.
 */
function loadOctokit(): Promise<OctokitModules> {
  octokitModules ??= Promise.all([
    import("@octokit/app"),
    import("@octokit/core"),
    import("@octokit/plugin-paginate-rest"),
    import("@octokit/request"),
  ]).then(([app, core, paginate, req]) => ({
    App: app.App,
    Octokit: core.Octokit,
    paginateRest: paginate.paginateRest,
    request: req.request,
  }));
  return octokitModules;
}

/**
 * Builds the production {@link GitHubApi} on `@octokit/app`.
 *
 * @param config the App, or null when none is set up; then every method except `convertManifest` throws
 *   `ConflictError`
 * @param fetchImpl the fetch to send requests with; tests pass a stub
 */
export function octokitGitHubApi(config: GitHubAppConfig | null, fetchImpl?: typeof fetch): GitHubApi {
  let app: App<{ Octokit: ReturnType<typeof octokitClass> }> | undefined;
  const requireApp = async () => {
    if (!config) throw new ConflictError("The GitHub App is not set up yet.");
    const mods = await loadOctokit();
    app ??= new mods.App({
      appId: config.appId,
      privateKey: config.privateKey,
      oauth: { clientId: config.clientId, clientSecret: config.clientSecret },
      Octokit: octokitClass(mods, fetchImpl),
    });
    return app;
  };
  const plainRequest = async () => (await loadOctokit()).request.defaults({ request: { fetch: fetchImpl } });

  return {
    async convertManifest(code) {
      const { data } = await (await plainRequest())("POST /app-manifests/{code}/conversions", { code });
      return {
        id: data.id,
        slug: data.slug ?? "",
        name: data.name,
        ownerLogin: (data.owner as { login?: string } | null)?.login ?? "",
        htmlUrl: data.html_url,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        webhookSecret: data.webhook_secret ?? "",
        pem: data.pem,
      };
    },

    async getInstallation(id) {
      const a = await requireApp();
      try {
        const { data } = await a.octokit.request("GET /app/installations/{installation_id}", { installation_id: id });
        return toInstallation(data as GhInstallation);
      } catch (error) {
        if ((error as { status?: unknown }).status === 404) return null;
        throw error;
      }
    },

    async listInstallations() {
      const a = await requireApp();
      const rows = await a.octokit.paginate("GET /app/installations", { per_page: 100 });
      return rows.map((i) => toInstallation(i as GhInstallation));
    },

    async listInstallationRepos(installationId) {
      const octokit = await (await requireApp()).getInstallationOctokit(installationId);
      const rows = await octokit.paginate("GET /installation/repositories", { per_page: 100 });
      return rows.map((r) => ({
        id: Number(r.id),
        fullName: r.full_name,
        ownerLogin: splitFullName(r.full_name).owner,
        private: r.private,
      }));
    },

    async updateWebhookSecret(secret) {
      await (await requireApp()).octokit.request("PATCH /app/hook/config", { secret });
    },

    async listFailedDeliveries(since) {
      const a = await requireApp();
      const failed: FailedDelivery[] = [];
      await a.octokit.paginate("GET /app/hook/deliveries", { per_page: 100 }, (response, done) => {
        for (const d of response.data) {
          const deliveredAt = new Date(d.delivered_at);
          if (deliveredAt <= since) {
            done();
            break;
          }
          if (d.status !== "OK") failed.push({ id: Number(d.id), event: d.event, deliveredAt, statusCode: d.status_code });
        }
        return [];
      });
      return failed;
    },

    async listCheckSuites(installationId, fullName, sha) {
      const octokit = await (await requireApp()).getInstallationOctokit(installationId);
      const { owner, repo } = splitFullName(fullName);
      const rows = await octokit.paginate("GET /repos/{owner}/{repo}/commits/{ref}/check-suites", {
        owner,
        repo,
        ref: sha,
        per_page: 100,
      });
      return rows.map((s) => ({ status: s.status ?? "", conclusion: s.conclusion ?? null }));
    },

    async exchangeOAuthCode(code) {
      if (!config) throw new ConflictError("The GitHub App is not set up yet.");
      const send = await plainRequest();
      const { data } = await send("POST https://github.com/login/oauth/access_token", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        headers: { accept: "application/json" },
      });
      const token = (data as { access_token?: string }).access_token;
      if (!token) throw new InvalidError("GitHub did not accept the sign-in code.");
      const { data: me } = await send("GET /user", { headers: { authorization: `token ${token}` } });
      return { id: Number(me.id), login: me.login };
    },
  };
}

/** Returns an Octokit class with pagination that sends requests with `fetchImpl`. */
function octokitClass(mods: OctokitModules, fetchImpl: typeof fetch | undefined) {
  return mods.Octokit.plugin(mods.paginateRest).defaults({ request: { fetch: fetchImpl } });
}

/** Returns the {@link GitHubApi} for the configured App; used by routes, ops callers and the worker. */
export async function getGitHubApi(db: Db): Promise<GitHubApi> {
  return octokitGitHubApi(await loadAppConfig(db));
}
