"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, GitBranch, KeyRound, Laptop, Link2, LogOut, Monitor, Moon, Palette, ShieldCheck, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { authClient } from "@/lib/auth/client";
import { useTRPC } from "@/trpc/client";

/**
 * The account row at the bottom of the sidebar: a menu grouped into personal settings (notifications, API keys,
 * connections when the GitHub App is set up, sessions), admin pages (accounts, GitHub App, audit; admins only), a
 * theme submenu and sign-out, plus a one-click light/dark switch. The notification inbox opens from the bell.
 */
export function UserArea({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const trpc = useTRPC();
  const { data: github } = useQuery(trpc.github.account.queryOptions());
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <PersonAvatar name={name} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold">{name}</span>
            <span className="text-[11px] text-muted-foreground">{isAdmin ? "Admin" : "Account"}</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/settings/notifications">
                <BellRing /> Notification settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/api-keys">
                <KeyRound /> API keys
              </Link>
            </DropdownMenuItem>
            {github?.configured && (
              <DropdownMenuItem asChild>
                <Link href="/settings/connections">
                  <Link2 /> Connections
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/settings/sessions">
                <Laptop /> Sessions
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">Admin</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/admin/users">
                    <Users /> Accounts
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/github">
                    <GitBranch /> GitHub App
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/audit">
                    <ShieldCheck /> Audit
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette /> Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="system">
                  <Monitor /> System
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <Sun /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon /> Dark
                </DropdownMenuRadioItem>
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
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Toggle light and dark theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="flex size-[30px] shrink-0 items-center justify-center border bg-card text-fg-2 hover:text-foreground"
      >
        <Moon className="size-[15px] dark:hidden" aria-hidden />
        <Sun className="hidden size-[15px] dark:block" aria-hidden />
      </button>
    </div>
  );
}
