"use client";

import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { ErrorScreen } from "@/components/status-screens";
import { cn } from "@/lib/utils";
import en from "../../messages/en";
import "./globals.css";

/** Same fonts as the root layout, which this boundary replaces. */
const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

/** The messages this boundary needs; it replaces the root layout and its provider, so it cannot read the user's language and stays English. */
const MESSAGES = { common: en.common, errors: en.errors };

/** Error boundary of the root layout; replaces it, so it renders its own `<html>`, `<body>` and message provider with the same styles. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={cn("antialiased font-sans", sans.variable, display.variable, mono.variable)}>
      <body className="min-h-dvh bg-background text-foreground">
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <ErrorScreen digest={error.digest} onRetry={retry} homeHref="/" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
