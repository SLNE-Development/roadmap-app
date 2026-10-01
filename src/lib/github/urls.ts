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
