import type { CheckSuiteInfo, FailedDelivery, GitHubApi, InstallationInfo, ManifestConversion, RepoInfo } from "./api";

/** What {@link fakeGitHubApi} answers with. */
export interface FakeSeed {
  installations: InstallationInfo[];
  repos: Record<number, RepoInfo[]>;
  /** Check suites keyed `fullName@sha`. */
  suites: Record<string, CheckSuiteInfo[]>;
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
  const state: FakeSeed = { installations: [], repos: {}, suites: {}, ...seed };
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });

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
  };
}
