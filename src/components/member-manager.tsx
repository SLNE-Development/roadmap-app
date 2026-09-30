"use client";

import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { removeMemberAction, setMemberAction } from "@/app/(app)/p/[project]/actions";
import { RoleTag, ROLE_LABEL } from "@/components/chips";
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
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAction } from "./use-action";

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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} disabled={disabled} className={cn("justify-between font-normal", className)}>
          {ROLE_LABEL[value]}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ProjectRole)}>
          {PROJECT_ROLES.map((r) => (
            <DropdownMenuRadioItem key={r} value={r}>
              {ROLE_LABEL[r]}
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
  const [open, setOpen] = useState(false);
  const chosen = candidates.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Person to add"
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
              <span className="flex-1 truncate text-muted-foreground">Add someone from the allowlist</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder="Search people…" />
          <CommandList>
            <CommandEmpty>Nobody matches.</CommandEmpty>
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
  const { pending, act } = useAction();
  const candidates = users.filter((u) => !members.some((m) => m.userId === u.id));
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("editor");

  return (
    <section className="flex flex-col gap-4" aria-busy={pending}>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[22px] font-semibold">Members</h2>
        <p className="text-[13.5px] leading-normal text-fg-2">
          Owners manage settings and members. Editors change systems, tasks and documents. Viewers only read. Admins can do everything
          everywhere.
        </p>
      </div>

      {canOwn &&
        (candidates.length === 0 ? (
          <p className="border bg-card px-3.5 py-3 text-[13.5px] text-muted-foreground">Everyone on the allowlist is already a member.</p>
        ) : (
          <form
            className="flex flex-col gap-2 border bg-card p-3.5 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const name = candidates.find((c) => c.id === userId)?.name;
              act(
                () => setMemberAction(projectSlug, { userId, role }),
                () => {
                  setUserId("");
                  toast.success(`${name ?? "Member"} added as ${ROLE_LABEL[role].toLowerCase()}`);
                },
              );
            }}
          >
            <UserPicker candidates={candidates} value={userId} onChange={setUserId} />
            <div className="flex gap-2">
              <RoleMenu value={role} onChange={setRole} label="Role of the new member" className="h-[34px] w-[130px]" />
              <Button type="submit" disabled={pending || !userId} className="flex-1 sm:flex-none">
                Add member
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
                    {you && <span className="text-xs text-muted-foreground">you</span>}
                  </span>
                  <time dateTime={m.joinedAt} className="text-xs text-muted-foreground">
                    Since {formatDate(m.joinedAt)}
                  </time>
                </span>
              </span>
              {canOwn ? (
                <span className="flex items-center gap-1 sm:contents">
                  <RoleMenu
                    value={m.role}
                    label={`Role of ${m.name}`}
                    disabled={pending}
                    className="w-[110px] sm:w-full"
                    onChange={(r) => {
                      if (r === m.role) return;
                      act(
                        () => setMemberAction(projectSlug, { userId: m.userId, role: r }),
                        () => toast.success(`${m.name} is now ${ROLE_LABEL[r].toLowerCase()}`),
                      );
                    }}
                  />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} disabled={pending} className="text-muted-foreground">
                        <XIcon />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{you ? "Leave this project?" : `Remove ${m.name} from the project?`}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {you ? "You lose access unless someone adds you again." : "They lose access to this project unless they are added again."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => act(() => removeMemberAction(projectSlug, m.userId), () => toast.success(`${m.name} removed`))}
                        >
                          Remove
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
