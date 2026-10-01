"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, GitBranch, KeyRound, Languages, Laptop, Link2, LogOut, Monitor, Moon, Palette, ShieldCheck, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/person-avatar";
import { LOCALES, type Locale } from "@/i18n/locale";
import { authClient } from "@/lib/auth/client";
import { useTRPC } from "@/trpc/client";

/** Language names are shown in their own language and are not translated. */
const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch" };

/**
 * The account row at the bottom of the sidebar: a menu grouped into personal settings (notifications, API keys,
 * connections when the GitHub App is set up, sessions), admin pages (accounts, GitHub App, audit; admins only), a
 * theme and language submenus and sign-out, plus a one-click light/dark switch. The notification inbox opens from the bell.
 */
export function UserArea({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const trpc = useTRPC();
  const { data: github } = useQuery(trpc.github.account.queryOptions());
  const setLocale = useMutation(
    trpc.account.setLocale.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <PersonAvatar name={name} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold">{name}</span>
            <span className="text-[11px] text-muted-foreground">{isAdmin ? t("roleAdmin") : t("roleAccount")}</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/settings/notifications">
                <BellRing /> {t("notificationSettings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/api-keys">
                <KeyRound /> {t("apiKeys")}
              </Link>
            </DropdownMenuItem>
            {github?.configured && (
              <DropdownMenuItem asChild>
                <Link href="/settings/connections">
                  <Link2 /> {t("connections")}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/settings/sessions">
                <Laptop /> {t("sessions")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t("adminSection")}</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/admin/users">
                    <Users /> {t("accounts")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/github">
                    <GitBranch /> {t("githubApp")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/audit">
                    <ShieldCheck /> {t("audit")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette /> {t("theme")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="system">
                  <Monitor /> {t("themeSystem")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <Sun /> {t("themeLight")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon /> {t("themeDark")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages /> {t("language")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(value) => {
                  if (value !== locale) setLocale.mutate({ locale: value as Locale });
                }}
              >
                {LOCALES.map((code) => (
                  <DropdownMenuRadioItem key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            variant="destructive"
            onSelect={async () => {
              await authClient.signOut();
              queryClient.clear();
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut /> {t("signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={t("toggleTheme")}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="flex size-[30px] shrink-0 items-center justify-center border bg-card text-fg-2 hover:text-foreground"
      >
        <Moon className="size-[15px] dark:hidden" aria-hidden />
        <Sun className="hidden size-[15px] dark:block" aria-hidden />
      </button>
    </div>
  );
}
