import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import "./globals.css";

/** Sans-serif UI font. */
const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });

/** Display font for page titles and section headings. */
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });

/** Monospace font for ids, hashes and code. */
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

/**
 * Page metadata shared by every route. Built per request so absolute URLs (Open Graph,
 * canonical) use the deployed `BETTER_AUTH_URL`. Icons, the manifest and the share image
 * come from the file conventions next to this layout.
 */
export function generateMetadata(): Metadata {
  return {
    metadataBase: siteUrl(),
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    appleWebApp: { title: SITE_NAME, statusBarStyle: "default" },
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: { type: "website", siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  };
}

/** Browser chrome color following the light and dark backgrounds. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1216" },
  ],
  colorScheme: "light dark",
};

/**
 * Root layout: fonts, theme (system light/dark), tooltips and toasts around every page.
 *
 * @param props.children the page content
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("antialiased font-sans", sans.variable, display.variable, mono.variable)}>
      <body className="min-h-dvh bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster richColors mobileOffset={{ bottom: 88 }} />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
