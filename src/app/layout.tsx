import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

/** Sans-serif UI font. */
const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });

/** Monospace font for ids, hashes and code. */
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

/** Page metadata shared by every route. */
export const metadata: Metadata = {
  title: "Roadmap",
  description: "Multi-project roadmap, planning and progress tracker",
};

/**
 * Root layout: fonts, theme (system light/dark), tooltips and toasts around every page.
 *
 * @param props.children the page content
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("antialiased font-sans", sans.variable, mono.variable)}>
      <body className="min-h-dvh bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster richColors />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
