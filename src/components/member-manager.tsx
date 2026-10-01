"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { RoleTag } from "@/components/chips";
import { PersonAvatar } from "@/components/person-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROJECT_ROLES, type ProjectRole } from "@/db/schema";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** A button opening a menu of project roles; `onChange` gets the chosen one. */
function RoleMenu({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: ProjectRole;
  onChange: (role: ProjectRole) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("enums");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} disabled={disabled} className={cn("justify-between font-normal", className)}>
          {t(`role.${value}`)}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ProjectRole)}>
          {PROJECT_ROLES.map((r) => (
            <DropdownMenuRadioItem key={r} value={r}>
              {t(`role.${r}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A searchable picker of the allowlisted users who are not members yet. */
function UserPicker({
  candidates,
  value,
  onChange,
}: {
  candidates: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const chosen = candidates.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("members.personToAdd")}
          className="flex h-[34px] min-w-0 flex-1 items-center gap-2 border border-input bg-background px-2.5 text-left text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {chosen ? (
            <>
              <PersonAvatar name={chosen.name} size="xs" />
              <span className="flex-1 truncate">{chosen.name}</span>
            </>
          ) : (
            <>
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate text-muted-foreground">{t("members.addFromAllowlist")}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder={t("members.searchPeople")} />
          <CommandList>
            <CommandEmpty>{t("members.nobodyMatches")}</CommandEmpty>
            {candidates.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.name} ${c.id}`}
                onSelect={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <PersonAvatar name={c.name} size="xs" />
                {c.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The members settings: a row adding an allowlisted user with a role, and the
 * member list with join dates, role menus and removal. Owners edit; everyone
 * else sees role tags.
 */
export function MemberManager({
  projectSlug,
  members,
  users,
  currentUserId,
  canOwn,
}: {
  projectSlug: string;
  /** The members, each with when they joined (ISO). */
  members: { userId: string; name: string; role: ProjectRole; joinedAt: string }[];
  users: { id: string; name: string }[];
  currentUserId: string;
  canOwn: boolean;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const format = useFormatter();
  const trpc = useTRPC();
  const router = useRouter();
  // Follow-ups live on the hooks: adding the last candidate replaces the form, and the
  // removed member's row (with its dialog) is gone once the refetch settles.
  const set = useMutation(
    trpc.members.set.mutationOptions({
      // Captured before the refetch, which turns the added user into a member.
      onMutate: ({ member }) => ({
        existing: members.find((m) => m.userId === member.userId)?.name,
        added: users.find((u) => u.id === member.userId)?.name,
      }),
      onSuccess: (_data, { member }, names) => {
        if (names?.existing) return void toast.success(t("members.roleChanged", { name: names.existing, role: te(`role.${member.role}`) }));
        setUserId("");
        toast.success(t("members.added", { name: names?.added ?? t("members.fallbackName"), role: te(`role.${member.role}`) }));
      },
    }),
  );
  const remove = useMutation(
    trpc.members.remove.mutationOptions({
      onMutate: ({ userId: removed }) => members.find((m) => m.userId === removed)?.name,
      onSuccess: (_data, _variables, name) => toast.success(t("members.removed", { name: name ?? t("members.fallbackName") })),
    }),
  );
  // Removing yourself drops the project's queries, which would only fail once access is gone.
  const leave = useMutation({
    ...trpc.members.remove.mutationOptions({
      onSuccess: () => {
        toast.success(t("members.left"));
        router.push("/");
      },
    }),
    meta: { leavesProject: projectSlug },
  });
  const pending = set.isPending || remove.isPending || leave.isPending;
  const candidates = users.filter((u) => !members.some((m) => m.userId === u.id));
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("editor");

  return (
    <section className="flex flex-col gap-4" aria-busy={pending}>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[22px] font-semibold">{t("members.title")}</h2>
        <p className="text-[13.5px] leading-normal text-fg-2">
          {t("members.description")}
        </p>
      </div>

      {canOwn &&
        (candidates.length === 0 ? (
          <p className="border bg-card px-3.5 py-3 text-[13.5px] text-muted-foreground">{t("members.allAdded")}</p>
        ) : (
          <form
            className="flex flex-col gap-2 border bg-card p-3.5 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              set.mutate({ project: projectSlug, member: { userId, role } });
            }}
          >
            <UserPicker candidates={candidates} value={userId} onChange={setUserId} />
            <div className="flex gap-2">
              <RoleMenu value={role} onChange={setRole} label={t("members.newRole")} className="h-[34px] w-[130px]" />
              <Button type="submit" disabled={pending || !userId} className="flex-1 sm:flex-none">
                {t("members.add")}
              </Button>
            </div>
          </form>
        ))}

      <ul className="flex flex-col border bg-card">
        {members.map((m) => {
          const you = m.userId === currentUserId;
          return (
            <li
              key={m.userId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3.5 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_130px_34px]"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <PersonAvatar name={m.name} size="md" />
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium">{m.name}</span>
                    {you && <span className="text-xs text-muted-foreground">{t("members.you")}</span>}
                  </span>
                  <time dateTime={m.joinedAt} className="text-xs text-muted-foreground">
                    {t("members.since", { date: format.dateTime(new Date(m.joinedAt), { day: "numeric", month: "short", year: "numeric" }) })}
                  </time>
                </span>
              </span>
              {canOwn ? (
                <span className="flex items-center gap-1 sm:contents">
                  <RoleMenu
                    value={m.role}
                    label={t("members.roleOf", { name: m.name })}
                    disabled={pending}
                    className="w-[110px] sm:w-full"
                    onChange={(r) => {
                      if (r === m.role) return;
                      set.mutate({ project: projectSlug, member: { userId: m.userId, role: r } });
                    }}
                  />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t("members.remove", { name: m.name })} disabled={pending} className="text-muted-foreground">
                        <XIcon />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{you ? t("members.leaveTitle") : t("members.removeTitle", { name: m.name })}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {you ? t("members.leaveDescription") : t("members.removeDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("members.keep")}</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => (you ? leave : remove).mutate({ project: projectSlug, userId: m.userId })}
                        >
                          {tc("remove")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </span>
              ) : (
                <span className="sm:col-span-2">
                  <RoleTag role={m.role} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
