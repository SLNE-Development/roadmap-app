import type {
  AppPermissions,
  CheckSuiteInfo,
  CommentInfo,
  FailedDelivery,
  GitHubApi,
  InstallationInfo,
  ManifestConversion,
  PullRequestInfo,
  RepoInfo,
} from "./api";
import { REQUIRED_EVENTS, REQUIRED_PERMISSIONS } from "./manifest";

/** What {@link fakeGitHubApi} answers with. */
export interface FakeSeed {
  installations: InstallationInfo[];
  repos: Record<number, RepoInfo[]>;
  /** Check suites keyed `fullName@sha`. */
  suites: Record<string, CheckSuiteInfo[]>;
  /** Pull requests keyed `fullName#number`. */
  pulls: Record<string, PullRequestInfo>;
  /** Comments on issues and pull requests, keyed `fullName#number`. */
  comments: Record<string, CommentInfo[]>;
  /** Repo `fullName` to the GitHub logins that can read it; defaults to none. */
  readers?: Record<string, string[]>;
  /** GitHub user id to current login; unknown ids answer null. */
  logins?: Record<number, string>;
  /** The App's permissions and events; defaults to exactly what the App requires. */
  appPermissions?: AppPermissions;
  /** Method name to HTTP status: that method throws an error carrying the status, like a GitHub 403. */
  failWith?: Partial<Record<string, number>>;
  conversion?: ManifestConversion;
  oauthUser?: { id: number; login: string };
  failedDeliveries?: FailedDelivery[];
}

/**
 * Returns an in-memory {@link GitHubApi} for tests. It records every call and answers from `seed`; unknown
 * lookups return null or an empty list, like GitHub. Tests may change `seed` between calls.
 */
export function fakeGitHubApi(
  seed: Partial<FakeSeed> = {},
): GitHubApi & { calls: { method: string; args: unknown[] }[]; seed: FakeSeed } {
  const state: FakeSeed = { installations: [], repos: {}, suites: {}, pulls: {}, comments: {}, ...seed };
  const calls: { method: string; args: unknown[] }[] = [];
  let nextCommentId = 1000;
  /** Records the call, then throws when `failWith` names the method. */
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
    const status = state.failWith?.[method];
    if (status !== undefined) throw Object.assign(new Error(`fake GitHub: ${status}`), { status });
  };

  return {
    calls,
    seed: state,
    async convertManifest(code) {
      record("convertManifest", code);
      if (!state.conversion) throw new Error(`fake GitHub: no conversion for code ${code}`);
      return state.conversion;
    },
    async getInstallation(id) {
      record("getInstallation", id);
      return state.installations.find((i) => i.id === id) ?? null;
    },
    async listInstallations() {
      record("listInstallations");
      return state.installations;
    },
    async listInstallationRepos(installationId) {
      record("listInstallationRepos", installationId);
      return state.repos[installationId] ?? [];
    },
    async updateWebhookSecret(secret) {
      record("updateWebhookSecret", secret);
    },
    async listFailedDeliveries(since) {
      record("listFailedDeliveries", since);
      return (state.failedDeliveries ?? []).filter((d) => d.deliveredAt > since);
    },
    async listCheckSuites(installationId, fullName, sha) {
      record("listCheckSuites", installationId, fullName, sha);
      return state.suites[`${fullName}@${sha}`] ?? [];
    },
    async exchangeOAuthCode(code) {
      record("exchangeOAuthCode", code);
      if (!state.oauthUser) throw new Error(`fake GitHub: no OAuth user for code ${code}`);
      return state.oauthUser;
    },
    async getPullRequest(installationId, fullName, number) {
      record("getPullRequest", installationId, fullName, number);
      return state.pulls[`${fullName}#${number}`] ?? null;
    },
    async updatePullRequest(installationId, fullName, number, patch) {
      record("updatePullRequest", installationId, fullName, number, patch);
      const key = `${fullName}#${number}`;
      const pr = state.pulls[key];
      if (pr) state.pulls[key] = { ...pr, ...patch };
    },
    async findComment(installationId, fullName, number, marker) {
      record("findComment", installationId, fullName, number, marker);
      return (state.comments[`${fullName}#${number}`] ?? []).find((c) => c.body.includes(marker)) ?? null;
    },
    async createComment(installationId, fullName, number, body) {
      record("createComment", installationId, fullName, number, body);
      const comment = { id: nextCommentId++, body };
      (state.comments[`${fullName}#${number}`] ??= []).push(comment);
      return comment;
    },
    async updateComment(installationId, fullName, commentId, body) {
      record("updateComment", installationId, fullName, commentId, body);
      for (const list of Object.values(state.comments)) {
        const at = list.findIndex((c) => c.id === commentId);
        if (at >= 0) list[at] = { id: commentId, body };
      }
    },
    async canUserReadRepo(installationId, fullName, login) {
      record("canUserReadRepo", installationId, fullName, login);
      return state.readers?.[fullName]?.includes(login) ?? false;
    },
    async loginOf(githubId) {
      record("loginOf", githubId);
      return state.logins?.[githubId] ?? null;
    },
    async getAppPermissions() {
      record("getAppPermissions");
      return state.appPermissions ?? { permissions: { ...REQUIRED_PERMISSIONS }, events: [...REQUIRED_EVENTS] };
    },
  };
}
