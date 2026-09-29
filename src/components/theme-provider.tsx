"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Applies the system light or dark theme through the `dark` class. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
