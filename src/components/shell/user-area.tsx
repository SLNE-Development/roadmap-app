"use client";

import { KeyRound, LogOut, Monitor, Moon, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/person-avatar";
import { authClient } from "@/lib/auth/client";

/**
 * The account row at the bottom of the sidebar: a menu with API keys, accounts
 * (admins), theme and sign-out, plus a one-click light/dark switch.
 */
export function UserArea({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
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
          <DropdownMenuItem asChild>
            <Link href="/settings/api-keys">
              <KeyRound /> API keys
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link href="/admin/users">
                <Users /> Accounts
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={async () => {
              await authClient.signOut();
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
