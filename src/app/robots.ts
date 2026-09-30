import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** Reads `BETTER_AUTH_URL` per request instead of baking the build host into the file. */
export const dynamic = "force-dynamic";

/** `robots.txt`: keeps crawlers out of the whole app; only the share image stays fetchable for link previews. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/opengraph-image", disallow: "/" },
    host: siteUrl().origin,
  };
}
