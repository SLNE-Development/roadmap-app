"use client";

import { useState } from "react";
import { removeMemberAction, setMemberAction } from "@/app/(app)/p/[project]/actions";
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
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PROJECT_ROLES, type ProjectRole } from "@/db/schema";
import { useAction } from "./use-action";

/** Members with role menus and removal, and a form adding a provisioned user. Owners edit; others read. */
export function MemberManager({
  projectSlug,
  members,
  users,
  canOwn,
}: {
  projectSlug: string;
  members: { userId: string; name: string; role: ProjectRole }[];
  users: { id: string; name: string }[];
  canOwn: boolean;
}) {
  const { pending, act } = useAction();
  const candidates = users.filter((u) => !members.some((m) => m.userId === u.id));
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("editor");

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {canOwn && (
        <Card>
          <CardContent>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(
                  () => setMemberAction(projectSlug, { userId, role }),
                  () => setUserId(""),
                );
              }}
            >
              <NativeSelect aria-label="User" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <NativeSelectOption value="">Choose a user…</NativeSelectOption>
                {candidates.map((u) => (
                  <NativeSelectOption key={u.id} value={u.id}>
                    {u.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {r}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button type="submit" disabled={pending || !userId}>
                Add member
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {canOwn && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>
                    {canOwn ? (
                      <NativeSelect
                        size="sm"
                        aria-label={`Role of ${m.name}`}
                        value={m.role}
                        disabled={pending}
                        onChange={(e) =>
                          act(() =>
                            setMemberAction(projectSlug, {
                              userId: m.userId,
                              role: e.target.value as ProjectRole,
                            }),
                          )
                        }
                      >
                        {PROJECT_ROLES.map((r) => (
                          <NativeSelectOption key={r} value={r}>
                            {r}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : (
                      m.role
                    )}
                  </TableCell>
                  {canOwn && (
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={pending}>
                            Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {m.name} from the project?</AlertDialogTitle>
                            <AlertDialogDescription>They lose access to this project unless they are added again.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => act(() => removeMemberAction(projectSlug, m.userId))}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
