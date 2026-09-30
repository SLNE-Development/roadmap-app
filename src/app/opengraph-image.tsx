import { ImageResponse } from "next/og";
import { BRAND_COLOR, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const alt = `${SITE_NAME}: ${SITE_DESCRIPTION}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share preview for links to the app (Open Graph and Twitter): the wave mark, name and tagline on the brand teal. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 36, padding: "0 96px", background: BRAND_COLOR, color: "#ffffff" }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
          <path d="M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
          <path d="M2 9c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
        </svg>
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>{SITE_NAME}</div>
        <div style={{ fontSize: 40, lineHeight: 1.3, opacity: 0.85, maxWidth: 900 }}>{SITE_DESCRIPTION}</div>
      </div>
    ),
    size,
  );
}
