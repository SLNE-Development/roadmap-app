import type { MetadataRoute } from "next";
import { BRAND_COLOR, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * Web app manifest (`/manifest.webmanifest`): lets browsers install the app with its
 * icon. The icon keeps its glyph inside the maskable safe zone, so one image serves both
 * purposes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8f8",
    theme_color: BRAND_COLOR,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
