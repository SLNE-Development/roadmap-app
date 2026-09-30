/** Product name shown in titles, the manifest and share previews. */
export const SITE_NAME = "Roadmap";

/** One-line description used for search results, the manifest and share previews. */
export const SITE_DESCRIPTION = "Multi-project roadmap, planning and progress tracker for teams that plan with agents.";

/** Brand teal of the icon and the primary color. */
export const BRAND_COLOR = "#0e7c86";

/** Public origin of the app from `BETTER_AUTH_URL`, read at request time so the Docker image needs no rebuild per host. */
export function siteUrl(): URL {
  return new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000");
}
