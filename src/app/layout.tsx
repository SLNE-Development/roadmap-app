import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getNow, getTimeZone } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import { TRPCReactProvider } from "@/trpc/client";
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
 * Root layout: fonts, language and time zone (next-intl), theme (system light/dark), tRPC with React Query, tooltips and toasts around every page.
 *
 * @param props.children the page content
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, timeZone, now] = await Promise.all([getLocale(), getTimeZone(), getNow()]);
  return (
    <html lang={locale} suppressHydrationWarning className={cn("antialiased font-sans", sans.variable, display.variable, mono.variable)}>
      <body className="min-h-dvh bg-background text-foreground">
        <NextIntlClientProvider locale={locale} timeZone={timeZone} now={now}>
          <ThemeProvider>
            <TRPCReactProvider>
              <TooltipProvider>
                {children}
                <Toaster richColors mobileOffset={{ bottom: 88 }} />
              </TooltipProvider>
            </TRPCReactProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
