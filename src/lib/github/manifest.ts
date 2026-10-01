export { manifestActionUrl } from "./urls";

/** GitHub's limit on an App name. */
const MAX_NAME = 34;

/** The App manifest GitHub registers a new App from. */
export interface AppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  request_oauth_on_install: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
}

/** Returns the suggested App name for the instance, `Roadmap (<host>)`, cut to GitHub's limit. */
export function defaultAppName(baseUrl: URL): string {
  return `Roadmap (${baseUrl.host})`.slice(0, MAX_NAME);
}

/**
 * Builds the manifest of a new App for the instance at `baseUrl`. `installation` and `installation_repositories`
 * are delivered to every App and must not be listed among the events.
 *
 * @param name the App name; blank means {@link defaultAppName}; cut to 34 characters
 */
export function buildManifest(baseUrl: URL, name: string): AppManifest {
  const origin = baseUrl.origin;
  return {
    name: (name.trim() || defaultAppName(baseUrl)).slice(0, MAX_NAME),
    url: origin,
    hook_attributes: { url: `${origin}/api/github/app`, active: true },
    redirect_url: `${origin}/api/github/manifest/callback`,
    callback_urls: [`${origin}/api/github/oauth/callback`],
    setup_url: `${origin}/api/github/setup`,
    setup_on_update: true,
    public: false,
    request_oauth_on_install: false,
    default_permissions: { metadata: "read", contents: "read", pull_requests: "read", checks: "read" },
    default_events: ["pull_request", "push", "check_suite"],
  };
}
