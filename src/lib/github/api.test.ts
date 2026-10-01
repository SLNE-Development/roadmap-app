import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { GitHubAppConfig } from "@/lib/ops/github-app";
import { ConflictError } from "@/lib/ops/errors";
import { octokitGitHubApi, type RepoInfo } from "./api";
import { fakeGitHubApi } from "./fake";

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

type Reply = { status?: number; json: unknown; headers?: Record<string, string> };

/** Returns a fetch stub that records each request and answers with `respond(url, method)`. */
function stubFetch(respond: (url: string, method: string) => Reply) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });
    const reply = respond(url, method);
    const response = new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
    // A real fetch response carries its URL; Octokit's pagination reads it.
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

/** Returns an App config with a throwaway RSA key, so app JWTs can be signed. */
function testConfig(): GitHubAppConfig {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    appId: 1234,
    slug: "roadmap-x",
    name: "Roadmap X",
    ownerLogin: "SLNE-Development",
    htmlUrl: "https://github.com/apps/roadmap-x",
    clientId: "Iv1.client",
    clientSecret: "client-secret",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    webhookSecret: "hook-secret",
    previousWebhookSecret: null,
    previousSecretExpiresAt: null,
    linkPolicy: "owners",
  };
}

/** Returns `count` repos in GitHub's shape, numbered from `from`. */
function ghRepos(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    full_name: `SLNE-Development/repo-${from + i}`,
    private: i % 2 === 0,
  }));
}

describe("octokitGitHubApi", () => {
  it("converts a manifest code without app credentials", async () => {
    const { fetchImpl, requests } = stubFetch(() => ({
      status: 201,
      json: {
        id: 7,
        slug: "roadmap-x",
        name: "Roadmap X",
        owner: { login: "SLNE-Development" },
        html_url: "https://github.com/apps/roadmap-x",
        client_id: "Iv1.abc",
        client_secret: "shh",
        webhook_secret: "hook",
        pem: "-----BEGIN RSA PRIVATE KEY-----",
      },
    }));
    const conversion = await octokitGitHubApi(null, fetchImpl).convertManifest("abc");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: "https://api.github.com/app-manifests/abc/conversions", method: "POST" });
    expect(conversion).toEqual({
      id: 7,
      slug: "roadmap-x",
      name: "Roadmap X",
      ownerLogin: "SLNE-Development",
      htmlUrl: "https://github.com/apps/roadmap-x",
      clientId: "Iv1.abc",
      clientSecret: "shh",
      webhookSecret: "hook",
      pem: "-----BEGIN RSA PRIVATE KEY-----",
    });
  });

  it("lists every page of an installation's repos", async () => {
    const { fetchImpl, requests } = stubFetch((url, method) => {
      if (method === "POST" && url.endsWith("/app/installations/42/access_tokens")) {
        return { status: 201, json: { token: "ghs_test", expires_at: new Date(Date.now() + 3_600_000).toISOString() } };
      }
      if (url.includes("page=2")) {
        return { json: { total_count: 103, repositories: ghRepos(101, 3) } };
      }
      return {
        json: { total_count: 103, repositories: ghRepos(1, 100) },
        headers: { link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"' },
      };
    });
    const repos = await octokitGitHubApi(testConfig(), fetchImpl).listInstallationRepos(42);
    expect(repos).toHaveLength(103);
    expect(repos[102]).toEqual({ id: 103, fullName: "SLNE-Development/repo-103", ownerLogin: "SLNE-Development", private: true });
    expect(requests.filter((r) => r.url.includes("/installation/repositories"))).toHaveLength(2);
  });

  it("returns null for an unknown installation", async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 404, json: { message: "Not Found" } }));
    expect(await octokitGitHubApi(testConfig(), fetchImpl).getInstallation(9)).toBeNull();
  });

  it("refuses app calls until the App is set up", async () => {
    await expect(octokitGitHubApi(null).listInstallations()).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("fakeGitHubApi", () => {
  it("answers from its seed and records the call", async () => {
    const r1: RepoInfo = { id: 1, fullName: "SLNE-Development/one", ownerLogin: "SLNE-Development", private: false };
    const api = fakeGitHubApi({ repos: { 42: [r1] } });
    expect(await api.listInstallationRepos(42)).toEqual([r1]);
    expect(api.calls).toEqual([{ method: "listInstallationRepos", args: [42] }]);
  });
});
