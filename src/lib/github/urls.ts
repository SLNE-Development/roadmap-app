import { InvalidError } from "@/lib/ops/errors";

/** A GitHub account or organization login. */
const ORG = /^[A-Za-z0-9-]{1,39}$/;

/**
 * Returns where the App manifest form posts to: the new-App page of the signed-in user or of `org`.
 *
 * @throws InvalidError when `org` is not a valid login
 */
export function manifestActionUrl(org: string | null, state: string): string {
  const q = `state=${encodeURIComponent(state)}`;
  if (org === null) return `https://github.com/settings/apps/new?${q}`;
  if (!ORG.test(org)) throw new InvalidError("The organization must be a GitHub login: letters, digits and dashes, at most 39.");
  return `https://github.com/organizations/${org}/settings/apps/new?${q}`;
}

/** Returns the page that installs the App with the slug on an account. */
export function installUrl(slug: string, state: string): string {
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Returns the GitHub page where the account's owners manage the installation. */
export function installationManageUrl(i: { id: number; accountLogin: string; accountType: "User" | "Organization" }): string {
  return i.accountType === "Organization"
    ? `https://github.com/organizations/${i.accountLogin}/settings/installations/${i.id}`
    : `https://github.com/settings/installations/${i.id}`;
}

/**
 * Returns the App's permissions page on GitHub: under the organization when the owner is one, else under the user.
 *
 * @param ownerIsOrg whether the App's owner is an organization
 */
export function appSettingsUrl(app: { slug: string; ownerLogin: string }, ownerIsOrg: boolean): string {
  return ownerIsOrg
    ? `https://github.com/organizations/${app.ownerLogin}/settings/apps/${app.slug}/permissions`
    : `https://github.com/settings/apps/${app.slug}/permissions`;
}

/**
 * Whether GitHub can reach the URL from the internet: false for localhost and `*.localhost`, `*.local`, loopback
 * (127.0.0.0/8, ::1), 0.0.0.0 and the private or link-local IPv4 ranges (10/8, 172.16/12, 192.168/16, 169.254/16).
 */
export function isPublicOrigin(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "::1" || host === "0.0.0.0") return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return true;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return !(a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254));
}

/** The message shown when the App cannot be created because GitHub cannot reach the site. */
export function unreachableOriginMessage(url: URL): string {
  return `GitHub can't reach ${url.origin}. Set BETTER_AUTH_URL to a public URL (for example a tunnel) to create the app here, or use an existing app.`;
}
